# aws-saml-login

Automated creation of temporary AWS credentials using the University of
Michigan's IdP and Amazon's SAML integration.

## Requirements

* Node.js (requires at least v7.6, tested with v8.11.1 and v9.11.1)

## Setup

```
npm install
```

## Usage

```
node aws-saml-login.js [options]
```

### Options

 *  `-p, --profile <boto profile>`

    where to store the credentials

 *  `-r, --role <rolename>`

    automatically select the first role that matches this pattern

 *  `-u, --user <uniqname>`

    login name

### Examples

```
$ node aws-saml-login.js -u ezekielh -r appdelivery-aws-admin -p appdelivery
Password:
Authenticating...
Sending Duo push...
Parsing response...
Assuming arn:aws:iam::236262816615:role/appdelivery-aws-admin...
Temporary credentials have been saved to the 'appdelivery' profile.
```

```
$ node aws-saml-login.js
Uniqname: ezekielh
Password:
Authenticating...
Sending Duo push...
Parsing response...

[0] arn:aws:iam::023382427380:role/ITS-AWS-VDC-Email-Prod-Admin
[1] arn:aws:iam::023382427380:role/ITS-AWS-VDC-Email-Prod-PowerUser
[2] arn:aws:iam::023382427380:role/ITS-AWS-VDC-Email-Prod-ReadOnly
[3] arn:aws:iam::236262816615:role/appdelivery-aws-admin
[4] arn:aws:iam::236262816615:role/appdelivery-aws-readonly
[5] arn:aws:iam::407225036496:role/ITS-AWS-VDC-Core-Non-Prod-Admin
[6] arn:aws:iam::440653842962:role/ITS-AWS-VDC-Email-Non-Prod-Admin
[7] arn:aws:iam::440653842962:role/ITS-AWS-VDC-Email-Non-Prod-PowerUser
[8] arn:aws:iam::440653842962:role/ITS-AWS-VDC-Email-Non-Prod-ReadOnly
[9] arn:aws:iam::690035594210:role/ITS-AWS-VDC-Core-PowerUser
[10] arn:aws:iam::772263914719:role/ITSCloudAmbassadors

Desired role: 5
Assuming arn:aws:iam::407225036496:role/ITS-AWS-VDC-Core-Non-Prod-Admin...
Temporary credentials have been saved to the 'saml' profile.

$ aws --profile saml --output text ec2 describe-addresses --query 'Addresses[].AssociationId'
eipassoc-5f964e7e
```
