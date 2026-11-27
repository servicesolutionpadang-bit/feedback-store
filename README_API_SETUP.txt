FEEDBACK STORE — GITHUB PAGES API BRIDGE

FILES
- index.html: GitHub Pages frontend, updated to call the Worker API.
- Code.gs: Existing Google Apps Script backend plus a protected doPost API bridge.
- worker.js: Cloudflare Worker proxy. It keeps the Apps Script URL and API secret off the public frontend.

IMPORTANT
1. Never commit API_SECRET, admin password, bot tokens, or spreadsheet credentials.
2. Replace API_URL in index.html with the deployed Cloudflare Worker URL.
3. Set Worker environment variables GAS_URL and API_SECRET as secrets/variables in Cloudflare.
4. Set Script Property FEEDBACK_API_SECRET to the exact same API_SECRET.
5. Deploy Apps Script as Web App, Execute as Me, access Anyone. The API secret protects calls.
6. Test with getLoginConfig before using real uploads.

API_SECRET: generate a random value with at least 32 characters and store it only in Apps Script Script Properties and Cloudflare Worker Secrets. Do not put it in GitHub.
