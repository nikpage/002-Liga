require('dotenv').config();
const crypto = require('crypto');
const fetch = require('node-fetch');

const SERVICE = (process.env.EWAY_SERVICE_URL || '').replace(/\/+$/, '');
const USER = process.env.EWAY_USERNAME;
const PASS = process.env.EWAY_PASSWORD;
const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

const POVERNA_TYPE = 'd88bc4e5-23b6-40c3-b592-7025c2a62188';
const FEMALE = '358f0e1b-1345-11e9-9313-b0fc3636a08b';

let SID = null;
async function call(method, body) {
    const res = await fetch(`${SERVICE}/API.svc/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: SID, ...body })
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return json;
}

function show(label, j) {
    console.log(`\n=== ${label} === rc=${j.ReturnCode || 'n/a'}${j.Description ? ' — ' + j.Description : ''}`);
    const s = JSON.stringify(j, null, 2);
    console.log(s.length > 2500 ? s.slice(0, 2500) + '\n...[truncated]' : s);
}

(async () => {
    const login = await call('LogIn', {
        userName: USER, passwordHash: md5(PASS), appVersion: 'LigaQA1.0',
        clientMachineIdentifier: 'liga-qa-dev', clientMachineName: 'liga-qa-dev'
    });
    SID = login.SessionId;
    if (!SID) { show('LogIn', login); process.exit(1); }
    console.log('Logged in. SID ok.');

    const ts = Date.now();
    const fileAs = `ZZ_RELTEST_${ts}`;

    // ---- Attempt 1: inline Relations on SaveJournal ----
    const save = await call('SaveJournal', {
        transmitObject: {
            FileAs: fileAs,
            Subject: fileAs,
            Note: 'reltest',
            TypeEn: POVERNA_TYPE,
            Relations: [{
                DifferDirection: true,
                ForeignFolderName: 'Contacts',
                ForeignItemGUID: FEMALE,
                RelationType: 'CONTACT'
            }]
        }
    });
    show('SaveJournal (inline Relations)', save);
    const guid = save.Guid;
    if (!guid) { console.error('No Guid returned, stopping.'); process.exit(1); }
    console.log('Journal GUID:', guid);

    async function readBack(label) {
        const r = await call('SearchJournals', {
            transmitObject: { ItemGUID: guid },
            includeForeignKeys: true,
            includeRelations: true
        });
        const item = (r.Data || [])[0] || {};
        console.log(`\n--- readback (${label}) ---`);
        console.log('TypeEn:', item.TypeEn);
        console.log('Relations:', JSON.stringify(item.Relations, null, 2));
        const hasContact = (item.Relations || []).some(rel =>
            (rel.RelationType === 'CONTACT') &&
            String(rel.ForeignItemGUID || '').toLowerCase() === FEMALE.toLowerCase());
        console.log('=> CONTACT relation to chosen contact present:', hasContact);
        return { item, hasContact };
    }

    let { hasContact } = await readBack('after inline');

    // ---- Attempt 2: SaveRelation, if inline did not stick ----
    if (!hasContact) {
        console.log('\nInline relation absent — trying SaveRelation...');
        const rel = await call('SaveRelation', {
            itemGuid: guid,
            folderName: 'Journals',
            foreignItemGuid: FEMALE,
            foreignFolderName: 'Contacts',
            relationType: 'CONTACT',
            differDirection: true
        });
        show('SaveRelation', rel);
        ({ hasContact } = await readBack('after SaveRelation'));
    }

    console.log('\n==== RESULT: contact attached =', hasContact, '====');

    // ---- Cleanup ----
    const del = await call('SaveJournal', {
        transmitObject: { ItemGUID: guid, Deleted: true }
    });
    show('Cleanup (mark Deleted)', del);

    await call('LogOut', {});
})().catch(e => { console.error('FATAL', e); process.exit(1); });
