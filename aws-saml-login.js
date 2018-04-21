const argparse = require('commander');
const puppeteer = require('puppeteer');
const prompt = require('async-prompt');
const sax = require('sax');
const aws = require('aws-sdk');
const ini = require('ini');

const util = require('util');
const path = require('path');
const os = require('os');
const fs = require('fs');

async function parseCLI() {
    argparse
        .version('1.0.0')
        .option('-d, --duomethod <method>', 'set Duo authentication method', 'push')
        .option('-p, --profile <boto profile>', 'where to store the credentials', 'saml')
        .option('-r, --role <rolename>', 'automatically select the first role that matches this pattern')
        .option('-u, --user <uniqname>', 'login name')
        .parse(process.argv);
    return(argparse);
}

function parseSAMLResponse(response) {
    return new Promise((resolve, reject) => {
        let roles = [];
        const decoder = new Buffer(response, 'base64');
        const parser = sax.parser();
        parser.ontext = (text) => {
            if (/^arn:aws:iam::.*/.test(text)) {
                const [ arn, principal ] = text.split(',');
                roles.push({ arn, principal });
            }
        };
        parser.onerror = (err) => {
            reject(err);
        }
        parser.onend = () => {
            resolve(roles);
        }
        parser.write(decoder.toString()).close();
    });
}

async function chooseRole(roles, arg) {
    if (arg) {
        const role = roles.find((elem) => {
            return elem.arn.search(arg) != -1;
        });
        if (role) {
            return(role);
        }
        console.log(`Unable to match ${arg} against an available role.`);
    }

    if (roles.length == 1) {
        return(roles[0]);
    }

    roles.sort((a, b) => {
        if (a.arn > b.arn) { return 1; }
        if (a.arn < b.arn) { return -1; }
        return 0;
    });
    const role_chooser = roles.map((r, index) => {
        return `[${index}] ${r.arn}`;
    });
    console.log('\n' + role_chooser.join('\n') + '\n');

    const index = await prompt('Desired role: ');
    return (roles[index]);
}

async function addAWSProfile(name, creds) {
    const creddir = path.join(os.homedir(), '.aws');
    if (!fs.existsSync(creddir)) {
        const mkdir = util.promisify(fs.mkdir);
        await mkdir(creddir, 0o750);
    }
    const credpath = path.join(creddir, 'credentials');

    let data = {};
    if (fs.existsSync(credpath)) {
        const readFile = util.promisify(fs.readFile);
        const raw = await readFile(credpath, 'utf8');
        data = ini.parse(raw);
    }

    data[name] = creds;

    const writeFile = util.promisify(fs.writeFile);
    return writeFile(credpath, ini.encode(data, {whitespace: true}), {encoding: 'utf8', mode: 0o640});
}

(async() => {
    const args = await parseCLI();
    if (! /^(push|passcode)$/.test(args.duomethod)) {
        console.log(`Unknown Duo method '${args.duomethod}', defaulting to 'push'`);
        args.duomethod = 'push';
    }
    if (!args.user) {
        args.user = await prompt('Uniqname: ');
    }
    const pass = await prompt.password('Password: ', '');

    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    await page.goto('https://shibboleth.umich.edu/idp/profile/SAML2/Unsolicited/SSO?providerId=urn:amazon:webservices');
    await page.waitForSelector('#login', {visible: true});
    console.log('Authenticating...');
    await page.type('#login', args.user);
    await page.type('#password', pass);
    await page.click('#loginSubmit');

    await page.waitForSelector('#duo_iframe');
    let duo = await page.$('#duo_iframe');
    duo = await duo.contentFrame();
    await duo.waitForSelector('.push-label .positive.auth-button', {visible: true});
    if (args.duomethod == 'push') {
        await new Promise((resolve) => {
            /* This shouldn't be necessary, but click() is being persnickety. */
            setTimeout(resolve, 500);
        });
        console.log('Sending Duo push...');
        await duo.click('.push-label .auth-button.positive');
    } else {
        const passcode = await prompt('Duo passcode: ');
        await duo.click('.passcode-label .auth-button.positive');
        await duo.waitForSelector('.passcode-label .passcode-input', {visible: true});
        await duo.type('.passcode-label .passcode-input', passcode);
        await duo.click('.passcode-label .auth-button.positive');
        console.log('Entered Duo passcode...');
    }

    /* A Duo push is valid for about 60 seconds after it's sent; bump
     * this timeout from 30 to 70 seconds.
     */
    await page.waitForNavigation({waitUntil: 'networkidle0', timeout: 70000});
    console.log('Parsing response...');
    let saml = await page.$('[name=SAMLResponse]');
    saml = await saml.getProperty('value');
    saml = await saml.jsonValue();
    await browser.close();

    const roles = await parseSAMLResponse(saml);
    const role = await chooseRole(roles, args.role);
    console.log(`Assuming ${role.arn}...`);

    const creds = await new Promise((resolve, reject) => {
        const sts = new aws.STS();
        sts.assumeRoleWithSAML({RoleArn: role.arn, PrincipalArn: role.principal, SAMLAssertion: saml}, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
    await addAWSProfile(args.profile, { aws_access_key_id: creds.Credentials.AccessKeyId, aws_secret_access_key: creds.Credentials.SecretAccessKey, aws_session_token: creds.Credentials.SessionToken });
    console.log(`Temporary credentials have been saved to the '${args.profile}' profile.`);
})();
