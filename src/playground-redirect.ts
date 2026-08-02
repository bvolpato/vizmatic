import { getLegacyPlaygroundRedirectUrl } from './playground-source'

const redirectUrl = getLegacyPlaygroundRedirectUrl(window.location.href)
if (redirectUrl) window.location.replace(redirectUrl)
