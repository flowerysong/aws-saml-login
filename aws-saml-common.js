exports.baseURL = 'https://shibboleth.umich.edu/idp/profile/SAML2/Unsolicited/SSO?providerId=urn:amazon:webservices';

exports.parseCLI = () => {
    return Promise.resolve(
        require('commander')
            .version('1.1.0')
            .option('-d, --duomethod <method>', 'set Duo authentication method', 'push')
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
                const [ arn, principal ] = text.split(',');
                roles.push({ arn, principal });
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

exports.assumeRole = (role, saml) => {
    return new Promise((resolve, reject) => {
        const aws = require('aws-sdk');
        const sts = new aws.STS();
        sts.assumeRoleWithSAML(
            {
                RoleArn: role.arn,
                PrincipalArn: role.principal,
                SAMLAssertion: saml,
            }, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}
