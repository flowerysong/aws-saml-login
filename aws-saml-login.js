const puppeteer = require('puppeteer');
const prompt = require('async-prompt');
const ini = require('ini');

const util = require('util');
const path = require('path');
const os = require('os');
const fs = require('fs');

const common = require('./aws-saml-common.js');

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

    data[name] = {
        aws_access_key_id: creds.Credentials.AccessKeyId,
        aws_secret_access_key: creds.Credentials.SecretAccessKey,
        aws_session_token: creds.Credentials.SessionToken,
    };

    const writeFile = util.promisify(fs.writeFile);
    return writeFile(credpath, ini.encode(data, {whitespace: true}), {encoding: 'utf8', mode: 0o640});
}

(async() => {
    const launch = puppeteer.launch();
    const args = await common.parseCLI();
    if (! /^(push|passcode)$/.test(args.duomethod)) {
        console.log(`Unknown Duo method '${args.duomethod}', defaulting to 'push'`);
        args.duomethod = 'push';
    }
    if (!args.user) {
        args.user = await prompt('Uniqname: ');
    }
    let pass = prompt.password('Password: ', '');

    const browser = await launch;
    const page = await browser.newPage();

    await page.goto(args.baseurl);
    const userElem = await Promise.race([
        page.waitForSelector('#login', {visible: true}),
        page.waitForSelector('#netid', {visible: true}),
    ]);
    pass = await pass;
    console.log('Authenticating...');
    await userElem.type(args.user);
    const passElem = await page.waitForSelector('#password', {visible: true});
    await passElem.type(pass);
    await passElem.press('Enter');

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
        let passcode = prompt('Duo passcode: ');
        await duo.click('.passcode-label .auth-button.positive');
        await duo.waitForSelector('.passcode-label .passcode-input', {visible: true});
        passcode = await passcode;
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
    browser.close();

    const roles = await common.parseSAMLResponse(saml);
    const role = await chooseRole(roles, args.role);
    console.log(`Assuming ${role.arn}...`);
    const creds = await common.assumeRole(role, saml);
    await addAWSProfile(args.profile, creds);
    console.log(`Temporary credentials have been saved to the '${args.profile}' profile.`);
})();
