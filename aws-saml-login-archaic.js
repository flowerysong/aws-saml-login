const argparse = require('commander');
const puppeteer = require('puppeteer');
const prompt = require('prompt');
const sax = require('sax');
const aws = require('aws-sdk');
const ini = require('ini');

const util = require('util');
const path = require('path');
const os = require('os');
const fs = require('fs');

function parseCLI() {
    return Promise.resolve(
        argparse
            .version('1.0.0')
            .option('-d, --duomethod <method>', 'set Duo authentication method', 'push')
            .option('-p, --profile <boto profile>', 'where to store the credentials', 'saml')
            .option('-r, --role <rolename>', 'automatically select the first role that matches this pattern')
            .option('-u, --user <uniqname>', 'login name')
            .parse(process.argv)
    ).then((args) => {
        if (! /^(push|passcode)$/.test(args.duomethod)) {
            console.log(`Unknown Duo method '${args.duomethod}', defaulting to 'push'`);
            args.duomethod = 'push';
        }

        return new Promise((resolve) => {
            prompt.colors = false;
            prompt.message = '';
            prompt.override = args;
            prompt.start();
            prompt.addProperties(args, [{name: 'user', description: 'Uniqname'}, {name: 'pass', description: 'Password', hidden: true}], (err) => {
                resolve(args);
            });
        });
    });
}

function parseSAMLResponse(response) {
    return new Promise((resolve, reject) => {
        let roles = [];
        const decoder = new Buffer(response, 'base64');
        const parser = sax.parser();
        parser.ontext = (text) => {
            if (/^arn:aws:iam::.*/.test(text)) {
                const [ arn, principal ] = text.split(',');
                roles.push({ arn, principal, response });
            }
        };
        parser.onerror = (err) => {
            reject(err);
        }
        parser.onend = () => {
            roles.sort((a, b) => {
                if (a.arn > b.arn) { return 1; }
                if (a.arn < b.arn) { return -1; }
                return 0;
            });
            resolve(roles);
        }
        parser.write(decoder.toString()).close();
    });
}

function handleDuo(duo, duomethod) {
    return duo
        .waitForSelector('.push-label .positive.auth-button', {visible: true})
        .then(() => {
            if (duomethod == 'push') {
                return new Promise((resolve) => {
                    /* This shouldn't be necessary, but click() is
                    * being persnickety. */
                    setTimeout(resolve, 500);
                })
                .then(() => {
                    console.log('Sending Duo push...');
                    return duo.click('.push-label .auth-button.positive');
                });
            } else {
                return duo.click('.passcode-label .auth-button.positive')
                    .then(() => duo.waitForSelector('.passcode-label .passcode-input', {visible: true}))
                    .then(() => new Promise((resolve) => {
                        prompt.get([{name: 'passcode', description: 'Duo passcode'}], (err, result) => {
                            resolve(result.passcode);
                        })
                    }))
                    .then((passcode) => duo.type('.passcode-label .passcode-input', passcode))
                    .then(() => {
                        console.log('Entered Duo passcode...');
                        return duo.click('.passcode-label .auth-button.positive');
                    });
            }
        });
}

function chooseRole(roles, arg) {
    return new Promise((resolve) => {
        if (arg) {
            const role = roles.find((elem) => {
                return elem.arn.search(arg) != -1;
            });
            if (role) {
                resolve(role);
                return;
            }
            console.log(`Unable to match ${arg} against an available role.`);
        }

        if (roles.length == 1) {
            resolve(roles[0]);
            return;
        }

        const role_chooser = roles.map((r, index) => {
            return `[${index}] ${r.arn}`;
        });
        console.log('\n' + role_chooser.join('\n') + '\n');

        resolve(null);
    });
}

function assumeRole(role) {
    return new Promise((resolve, reject) => {
        const sts = new aws.STS();
        sts.assumeRoleWithSAML({RoleArn: role.arn, PrincipalArn: role.principal, SAMLAssertion: role.response}, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}

function addAWSProfile(name, creds) {
    const creddir = path.join(os.homedir(), '.aws');
    if (!fs.existsSync(creddir)) {
        fs.mkdirSync(creddir, 0o750);
    }
    const credpath = path.join(creddir, 'credentials');

    let data = {};
    if (fs.existsSync(credpath)) {
        const raw = fs.readFileSync(credpath, 'utf8');
        data = ini.parse(raw);
    }

    data[name] = creds;

    return(fs.writeFileSync(credpath, ini.encode(data, {whitespace: true}), {encoding: 'utf8', mode: 0o640}));
}

(() => {
    parseCLI().then((args) =>
    puppeteer.launch().then((browser) => {
        return browser.newPage()
            .then((page) => {
                return page.goto('https://shibboleth.umich.edu/idp/profile/SAML2/Unsolicited/SSO?providerId=urn:amazon:webservices')
                .then(() => page.waitForSelector('#login', {visible: true}))
                .then(() => {
                    console.log('Authenticating...');
                    return page.type('#login', args.user);
                })
                .then(() => page.type('#password', args.pass))
                .then(() => page.click('#loginSubmit'))
                .then(() => page.waitForSelector('#duo_iframe'))
                .then(() => page.$('#duo_iframe'))
                .then((duoelem) => duoelem.contentFrame())
                .then((duo) => handleDuo(duo, args.duomethod))
                .then(() => page.waitForNavigation({waitUntil: 'networkidle0', timeout: 70000}))
                .then(() => {
                    console.log('Parsing response...');
                    return page.waitForSelector('[name=SAMLResponse]')
                        .then(() => page.$('[name=SAMLResponse]'))
                        .then((elem) => elem.getProperty('value'))
                        .then((val) => val.jsonValue())
                        .then((jsonval) => parseSAMLResponse(jsonval))
                        .then((roles) => {
                            return chooseRole(roles, args.role)
                                .then((role) => {
                                    if (!role) {
                                        return new Promise((resolve) => {
                                            prompt.get([{name: 'index', description: 'Desired role'}], (err, result) => {
                                                resolve(result.index);
                                            });
                                        })
                                        .then((index) => roles[index]);
                                    }
                                    return role;
                                })
                        })
                        .then((role) => {
                            console.log(`Assuming ${role.arn}...`);
                            return assumeRole(role);
                        })
                        .then((creds) => {
                            addAWSProfile(args.profile, { aws_access_key_id: creds.Credentials.AccessKeyId, aws_secret_access_key: creds.Credentials.SecretAccessKey, aws_session_token: creds.Credentials.SessionToken });
                            console.log(`Temporary credentials have been saved to the '${args.profile}' profile.`);
                            return browser.close();
                        });
                });
            })
    })
    );
})();
