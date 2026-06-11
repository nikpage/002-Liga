const fetch = require('node-fetch');
const crypto = require('crypto');
const { eway: cfg } = require('./config');

// eWay-CRM Web Service API client (legacy login).
// Docs: https://github.com/eway-crm/api

const APP_VERSION = 'AV_001';
const CLIENT_ID = 'liga-qa-server';
const CLIENT_NAME = 'liga-qa-server';

let cachedSessionId = null;

function md5Hex(str) {
    return crypto.createHash('md5').update(str, 'utf8').digest('hex');
}

function serviceBase() {
    if (!cfg || !cfg.serviceUrl) {
        throw new Error('eWay-CRM Config Error: EWAY_SERVICE_URL is not set.');
    }
    return cfg.serviceUrl.replace(/\/+$/, '');
}

function passwordHash() {
    if (cfg.passwordHash) return cfg.passwordHash.toLowerCase();
    if (cfg.password) return md5Hex(cfg.password);
    throw new Error('eWay-CRM Config Error: EWAY_PASSWORD_HASH or EWAY_PASSWORD is required.');
}

async function postJson(path, body) {
    const res = await fetch(`${serviceBase()}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
        throw new Error(`eWay-CRM HTTP ${res.status}: ${data.Description || res.statusText}`);
    }
    return data;
}

async function login() {
    if (!cfg || !cfg.username) {
        throw new Error('eWay-CRM Config Error: EWAY_USERNAME is not set.');
    }

    const data = await postJson('/API.svc/LogIn', {
        userName: cfg.username,
        passwordHash: passwordHash(),
        appVersion: APP_VERSION,
        clientMachineIdentifier: CLIENT_ID,
        clientMachineName: CLIENT_NAME
    });

    if (data.ReturnCode !== 'rcSuccess' || !data.SessionId) {
        throw new Error(`eWay-CRM Login Failed: ${data.ReturnCode} - ${data.Description || 'Unknown error'}`);
    }

    cachedSessionId = data.SessionId;
    return cachedSessionId;
}

async function ensureSession() {
    if (cachedSessionId) return cachedSessionId;
    return await login();
}

// Calls any eWay-CRM API method with automatic re-login on session expiry.
async function callMethod(method, params = {}) {
    const sessionId = await ensureSession();
    const path = `/API.svc/${method}`;
    let data = await postJson(path, { sessionId, ...params });

    if (data.ReturnCode === 'rcBadSession') {
        cachedSessionId = null;
        const fresh = await login();
        data = await postJson(path, { sessionId: fresh, ...params });
    }

    if (data.ReturnCode !== 'rcSuccess') {
        throw new Error(`eWay-CRM ${method} Failed: ${data.ReturnCode} - ${data.Description || 'Unknown error'}`);
    }

    return data;
}

function logout() {
    cachedSessionId = null;
}

// Anonymous contacts used as the Journal "Kontakt". GUIDs confirmed from live eWay data.
// 51.7% female / remainder male.
const FEMALE_CONTACT_GUID = '358f0e1b-1345-11e9-9313-b0fc3636a08b'; // Anonym, Žena
const MALE_CONTACT_GUID = 'f0476ebf-1342-11e9-9313-b0fc3636a08b';   // Anonym, Muž

// eWay GUIDs (all confirmed against live eWay via diagnostic read-back).
const PORADNA_TYPE_GUID = 'd88bc4e5-23b6-40c3-b592-7025c2a62188'; // Typ = Poradna
const PROJECT_GUID = '8659c180-d43a-11f0-8dee-70d8233eee18';      // Sociální služby 2026
const TYP_KONTAKTU_TELEFONICKY = 'efdd0548-0d7b-4764-b7e0-bfb0a9776984'; // af_50
const FORMA_AMBULANTNI = 'a1618af4-4116-4c1e-b2ed-759e7c405e9e';         // af_41

// Builds a short (~3-word) title from the question text.
function threeWordTitle(question) {
    const words = (question || '').trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 3).join(' ') || 'Poradna';
}

// Logs a Q&A pair as a Poradna Journal in eWay-CRM. Verified-working fields:
//   Typ=Poradna, ~3-word title, Note=answer, EventStart/End, Typ kontaktu,
//   Forma, the anonymous Customer contact (51.7/48.3), and the SUPERIORITEM
//   link to the "Sociální služby 2026" project.
//
// Two confirmed eWay quirks drive the shape below:
//   1. Relations are NOT saved inline on SaveJournal — each needs its own
//      SaveRelation call (ItemGUID1/FolderName1 = item, ItemGUID2/FolderName2
//      = foreign item).
//   2. Type-specific additional fields are only writable AFTER the journal's
//      Type is set, so we save Type first, then the AdditionalFields.
// Additional fields are nested under `AdditionalFields` (key `af_NN`, no
// underscore prefix). Kontakt/Intervence počet are computed by eWay, so they
// are not set here.
//
// Fire-and-forget: resolves silently on success, logs errors to console.
function logQA(question, answer) {
    if (!cfg || !cfg.username) return; // CRM not configured, skip silently

    const title = threeWordTitle(question);
    const contactGuid = Math.random() < 0.517 ? FEMALE_CONTACT_GUID : MALE_CONTACT_GUID;
    const start = new Date();
    const end = new Date(start.getTime() + (15 + Math.floor(Math.random() * 21)) * 60000);
    const iso = d => d.toISOString().replace(/\.\d{3}Z$/, '');

    const saveRelation = (journalGuid, foreignGuid, foreignFolder, relType) =>
        callMethod('SaveRelation', {
            transmitObject: {
                ItemGUID1: journalGuid, FolderName1: 'Journal',
                ItemGUID2: foreignGuid, FolderName2: foreignFolder,
                RelationType: relType, DifferDirection: true
            }
        });

    // Step 1: create the journal with its Type set.
    callMethod('SaveJournal', {
        transmitObject: {
            FileAs: title,
            Subject: title,
            Note: answer || '',
            TypeEn: PORADNA_TYPE_GUID,
            EventStart: iso(start),
            EventEnd: iso(end)
        }
    })
        .then(async saved => {
            const journalGuid = saved && saved.Guid;
            if (!journalGuid) throw new Error('SaveJournal returned no Guid');
            // Step 2: set the type-gated additional fields.
            await callMethod('SaveJournal', {
                transmitObject: {
                    ItemGUID: journalGuid,
                    TypeEn: PORADNA_TYPE_GUID,
                    AdditionalFields: {
                        af_50: TYP_KONTAKTU_TELEFONICKY, // Typ kontaktu = telefonický
                        af_41: FORMA_AMBULANTNI           // Forma = ambulantní
                    }
                }
            });
            // Relations: Customer contact + superior project.
            await saveRelation(journalGuid, contactGuid, 'Contacts', 'CONTACT');
            await saveRelation(journalGuid, PROJECT_GUID, 'Projects', 'SUPERIORITEM');
        })
        .catch(err => {
            console.error('EWAY QA LOG ERROR:', err.message);
        });
}

module.exports = { login, callMethod, logout, logQA };
