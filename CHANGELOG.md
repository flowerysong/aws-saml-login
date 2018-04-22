# v1.1.1 (2018-04-22)

* Made session duration configurable, set the default to four hours

* Made base URL configurable and added the possibility of supporting other IdPs.

* Fixed some sporadic failures on laggy networks.

# v1.1.0 (2018-04-21)

* Added `aws-saml-login-archaic.js`, which supports Node.js versions
  without async/await.

* Changed automatic role matching to use the sorted display order, making the
  result more predictable when multiple roles match.

* Increased the wait timeout after Duo authentication starts, since pushes
  might not return for quite a while.

# v1.0.0 (2018-04-19)

* Initial release
