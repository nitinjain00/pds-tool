# PDS राशन कार्ड टूल — Ready-to-Deploy Netlify App

Pre-wired to the live UP SmartPDS endpoint:
`POST https://smartpds.up.gov.in/Epos_Spring/fps/fpstransactionwitoutcatptcha`

**No environment variables required.**

## Deploy to Netlify (2 steps)
1. Upload the contents of this `pds-netlify-app` folder (`index.html`, `netlify.toml`, `package.json`, and `netlify/functions/pds-proxy.js`) to a GitHub repository.
2. In Netlify, click **Add new site → Import an existing project** and select that GitHub repository. Netlify automatically publishes `index.html` and activates `/.netlify/functions/pds-proxy`.

*(Or run `npx netlify-cli deploy --prod` from inside this folder on your PC.)*
