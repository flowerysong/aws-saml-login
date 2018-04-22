exports.parseCLI = () => {
    return Promise.resolve(
        require('commander')
            .version('1.1.1')
            .option('-b, --baseurl <URL>', 'base IdP URL', 'https://shibboleth.umich.edu/idp/profile/SAML2/Unsolicited/SSO?providerId=urn:amazon:webservices')
            .option('-d, --duomethod <method>', 'set Duo authentication method', 'push')
            .option('-D, --duration <seconds>', 'session duration', (input) => parseInt(input), 14400)
            .option('-p, --profile <boto profile>', 'where to store the credentials', 'saml')
            .option('-r, --role <rolename>', 'automatically select the first role that matches this pattern')
            .option('-u, --user <uniqname>', 'login name')
            .parse(process.argv)
    );
}

exports.parseSAMLResponse = (response) => {
    const sax = require('sax');
    return new Promise((resolve, reject) => {
        let roles = [];
        const decoder = new Buffer(response, 'base64');
        const parser = sax.parser();
        parser.ontext = (text) => {
            if (/^arn:aws:iam::.*/.test(text)) {
                /* Amazon's generic SAML setup guide says to return this
                 * attribute as RoleARN,PrincipalARN. Amazon's blog post on
                 * configuring Shibboleth says to return it as
                 * PrincipalARN,RoleARN. Automatically figure out which way it
                 * was done.
                 */
                const [ arn1, arn2 ] = text.split(',');
                if (/^arn:aws:iam::[0-9]*:role\//.test(arn1)) {
                    roles.push({ arn: arn1, principal: arn2 });
                } else {
                    roles.push({ arn: arn2, principal: arn1 });
                }
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

exports.assumeRole = (role, saml, duration) => {
    return new Promise((resolve, reject) => {
        const aws = require('aws-sdk');
        const sts = new aws.STS();
        sts.assumeRoleWithSAML(
            {
                RoleArn: role.arn,
                PrincipalArn: role.principal,
                SAMLAssertion: saml,
                DurationSeconds: duration,
            }, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}
