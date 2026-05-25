require('dotenv').config();
const crypto = require('crypto');
const fetch = require('node-fetch');

const SERVICE = (process.env.EWAY_SERVICE_URL || '').replace(/\/+$/, '');
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

function summarize(label, result) {
    const j = result.json || {};
    const rc = j.ReturnCode;
    const desc = j.Description;
    console.log(`\n=== ${label} ===`);
    console.log(`  HTTP ${result.status}  ReturnCode=${rc || 'n/a'}${desc ? '  — ' + desc : ''}`);
    // Surface array sizes from common response shapes
    for (const key of ['Data', 'UserItems', 'Permissions', 'AdditionalFields']) {
        if (Array.isArray(j[key])) console.log(`  ${key}.length = ${j[key].length}`);
    }
    const body = JSON.stringify(result.json || result.raw, null, 2);
    console.log(body.length > 1800 ? body.slice(0, 1800) + '\n  ...[truncated]' : body);
}

(async () => {
    console.log('Service:', SERVICE);
    console.log('User:   ', USER);
    if (!SERVICE || !USER || !PASS) {
        console.error('Missing EWAY_SERVICE_URL / EWAY_USERNAME / EWAY_PASSWORD in env.');
        process.exit(1);
    }

    // Optional: pass new password as argv[2] to clear a forced-change.
    const newPass = process.argv[2];
    const loginBody = {
        userName: USER,
        passwordHash: md5(PASS),
        appVersion: 'LigaQA1.0',
        clientMachineIdentifier: 'liga-qa-dev',
        clientMachineName: 'liga-qa-dev'
    };
    if (newPass) loginBody.newPasswordHash = md5(newPass);

    const login = await call('LogIn', loginBody);
    summarize('LogIn', login);

    const sid = login.json && login.json.SessionId;
    if (!sid) { console.error('\nNo SessionId — stopping.'); process.exit(1); }

    // --- READ-ONLY PROBES ---
    // Goal: confirm auth + infer write capability via permission flags,
    // without invoking any Save*/Delete* method.

    // 1. Per-module permissions. CanCreate/CanUpdate flags here are the
    //    cleanest signal that writes would succeed.
    for (const mod of ['Journal', 'SocialServices', 'Cases', 'Companies', 'Contacts', 'Documents']) {
        summarize(`GetModulePermissions(${mod})`,
            await call('GetModulePermissions', { sessionId: sid, moduleName: mod }));
    }

    // 2. Identity & user list — confirms read access and shows which
    //    account we're authenticated as.
    summarize('GetUsers',
        await call('GetUsers', { sessionId: sid, includeProfilePictures: false }));

    // 3. Search a known-safe module (Companies) to prove we can pull data.
    //    Empty transmitObject = no filter; response can be large, body is truncated.
    summarize('SearchCompanies (no filter)',
        await call('SearchCompanies', {
            sessionId: sid,
            transmitObject: {},
            includeForeignKeys: false,
            includeRelations: false
        }));

    // 4. Try Journal + SocialServices reads. If the module name is wrong
    //    for this tenant the call will fail loudly — that's useful intel.
    summarize('SearchJournal',
        await call('SearchJournal', {
            sessionId: sid,
            transmitObject: {},
            includeForeignKeys: false,
            includeRelations: false
        }));

    summarize('SearchSocialServices',
        await call('SearchSocialServices', {
            sessionId: sid,
            transmitObject: {},
            includeForeignKeys: false,
            includeRelations: false
        }));

    // 5. Field schema for the target write module — read-only, but tells
    //    us exactly which fields a future Save call would need to populate.
    summarize('GetAdditionalFields(SocialServices)',
        await call('GetAdditionalFields', { sessionId: sid, objectTypeName: 'SocialServices' }));

    summarize('GetAdditionalFields(Journal)',
        await call('GetAdditionalFields', { sessionId: sid, objectTypeName: 'Journal' }));

    // 6. Clean up the session.
    summarize('LogOut',
        await call('LogOut', { sessionId: sid }));
})();
