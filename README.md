# aws-saml-login

Automated creation of temporary AWS credentials using the University of
Michigan's IdP and Amazon's SAML integration.

## Requirements

* Node.js

  `aws-saml-login.js` requires >=v7.6

  `aws-saml-login-archaic.js` should work under v6.4, which is the oldest
  version supported by puppeteer.

* Chromium dependencies

  During setup puppeteer will automatically download a copy of Chromium that
  provides a working API, but it depends on a number of system libraries that
  aren't commonly present on servers. An example yum command line is provided
  below.

## Setup

```
sudo yum -y install nodejs pango libXcomposite libXcursor libXdamage libXext libXi libXtst cups-libs libXScrnSaver libXrandr GConf2 alsa-lib atk gtk3 ipa-gothic-fonts xorg-x11-fonts-100dpi xorg-x11-fonts-75dpi xorg-x11-utils xorg-x11-fonts-cyrillic xorg-x11-fonts-Type1 xorg-x11-fonts-misc

npm install
```

## Usage

```
node aws-saml-login.js [options]
```

### Options

 *  `-b, --baseurl <URL>`

    base IdP URL (default: https://shibboleth.umich.edu/idp/profile/SAML2/Unsolicited/SSO?providerId=urn:amazon:webservices)

 *  `-d, --duomethod <push|passcode>`

    which Duo authentication method to use (default: push)

 *  `-p, --profile <boto profile>`

    where to store the credentials (default: saml)

 *  `-r, --role <rolename>`

    automatically select the first role that matches this pattern

 *  `-u, --user <uniqname>`

    login name

### Examples

```
$ node aws-saml-login.js -u ezekielh -r appdelivery -p umcollab
Password:
Authenticating...
Sending Duo push...
Parsing response...
Assuming arn:aws:iam::236262816615:role/appdelivery-aws-admin...
Temporary credentials have been saved to the 'umcollab' profile.
```

```
$ node aws-saml-login.js -d passcode
Uniqname: ezekielh
Password:
Authenticating...
Duo passcode: 905490
Entered Duo passcode...
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
