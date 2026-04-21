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

module.exports = { login, callMethod, logout };
