const puppeteer = require('puppeteer');
const prompt = require('prompt');
const ini = require('ini');

const util = require('util');
const path = require('path');
const os = require('os');
const fs = require('fs');

const common = require('./aws-saml-common.js');

function parseCLI() {
    return common.parseCLI(
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

        resolve(new Promise((resolve) => {
            prompt.get([{name: 'index', description: 'Desired role'}], (err, result) => {
                resolve(result.index);
            });
        })
        .then((index) => roles[index]));
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

    data[name] = {
        aws_access_key_id: creds.Credentials.AccessKeyId,
        aws_secret_access_key: creds.Credentials.SecretAccessKey,
        aws_session_token: creds.Credentials.SessionToken,
    };

    const ret = fs.writeFileSync(credpath, ini.encode(data, {whitespace: true}), {encoding: 'utf8', mode: 0o640});
    console.log(`Temporary credentials have been saved to the '${name}' profile.`)
    return ret;
}

(() => {
    launch = puppeteer.launch();
    parseCLI().then((args) =>
        launch.then((browser) =>
            browser.newPage().then((page) =>
                page.goto(args.baseurl)
                .then(() => Promise.race([
                    page.waitForSelector('#login', {visible: true}),
                    page.waitForSelector('#netid', {visible: true}),
                ]))
                .then((userElem) => {
                    console.log('Authenticating...');
                    return userElem.type(args.user);
                })
                .then(() => page.waitForSelector('#password', {visible: true}))
                .then((passElem) => passElem.type(args.pass)
                        .then(() => passElem.press('Enter')))
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
                        .then((saml) => common.parseSAMLResponse(saml)
                                .then((roles) => {
                                    browser.close();
                                    return chooseRole(roles, args.role);
                                })
                                .then((role) => {
                                    console.log(`Assuming ${role.arn}...`);
                                    return common.assumeRole(role, saml);
                                }))
                        .then((creds) => addAWSProfile(args.profile, creds));
                })
            )
        )
    );
})();
