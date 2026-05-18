require('dotenv').config();
const crypto = require('crypto');
const fetch = require('node-fetch');

const SERVICE = process.env.EWAY_SERVICE_URL;
const USER = process.env.EWAY_USERNAME;
const PASS = process.env.EWAY_PASSWORD;

const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

async function call(method, body) {
    const res = await fetch(`${SERVICE}/API.svc/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const text = await res.text();
    try { return { status: res.status, json: JSON.parse(text) }; }
    catch { return { status: res.status, raw: text }; }
}

(async () => {
    console.log('Service:', SERVICE);
    console.log('User:   ', USER);

    const newPass = process.argv[2]; // optional: pass new password to clear forced-change
    const loginBody = {
        userName: USER,
        passwordHash: md5(PASS),
        appVersion: 'LigaQA1.0',
        clientMachineIdentifier: 'liga-qa-dev',
        clientMachineName: 'liga-qa-dev'
    };
    if (newPass) loginBody.newPasswordHash = md5(newPass);
    const login = await call('LogIn', loginBody);

    console.log('\n=== LogIn ===');
    console.log(JSON.stringify(login, null, 2));

    const sid = login.json && login.json.SessionId;
    if (!sid) { console.error('No SessionId — stopping.'); process.exit(1); }

    const modules = await call('GetModulePermissions', {
        sessionId: sid,
        moduleName: 'SocialServices'
    });
    console.log('\n=== GetModulePermissions(SocialServices) ===');
    console.log(JSON.stringify(modules, null, 2).slice(0, 2000));
})();
