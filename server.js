try {
    require('dotenv').config();
} catch (e) {
    // Railway handles variables natively; this prevents the crash
}

const express = require('express');
const path = require('path');
const cors = require('cors');
const { search } = require('./search');
const { getTTS } = require('./ai-client');
const { getQALogs, getAudienceCounts } = require('./database');
const { login: ewayLogin, callMethod: ewayCall } = require('./eway-crm');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Serve widget files with permissive CORS and caching
app.use('/widget', express.static(path.join(__dirname, 'widget'), {
    setHeaders(res) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=3600');
    }
}));

// Serves the index.html file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Handles the search request from the frontend
app.post('/search', async (req, res) => {
    try {
        const result = await search(req.body);
        res.json(result);
    } catch (error) {
        console.error("Route Error:", error);
        res.status(500).json({ error: 'Search failed' });
    }
});

/**
 * Cleans Markdown text for Text-to-Speech.
 * Removes emojis, source lists, download lists, and formatting.
 */
function cleanTextForTTS(text) {
    if (!text) return "";

    // 1. Remove the "Sources" and "Downloads" sections added by search.js
    const footerRegex = /\n\n---\n# (?:📄 Zdroje|📥 Ke stažení)[\s\S]*$/;
    text = text.replace(footerRegex, '');

    // 2. Remove Markdown Links [Text](URL) -> Text
    text = text.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

    // 3. Remove Bold/Italic (**text**, *text*, __text__)
    text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
    text = text.replace(/(\*|_)(.*?)\1/g, '$2');

    // 4. Remove Headers completely (# Header)
    text = text.replace(/^#+ .*$/gm, '');

    // 5. Remove Parentheses and their content completely
    // "word (explanation)" -> "word"
    text = text.replace(/\s*\([^)]*\)/g, '');

    // 6. Remove Czech Legal Entities (s.r.o., z.ú., etc.)
    // Matches patterns like ", s.r.o.", " s. r. o.", ", z.ú."
    // We remove them to make the company names sound natural.
    const legalEntitiesRegex = /(?:,\s*|\s+)(?:s\. ?r\. ?o\.|z\. ?[sú]\.|a\. ?s\.|o\. ?p\. ?s\.|v\. ?o\. ?s\.|k\. ?s\.)/gi;
    text = text.replace(legalEntitiesRegex, '');

    // 7. Remove Bullet points (•, -, *) at start of lines
    text = text.replace(/^[•*-]\s+/gm, '');

    // 8. Remove Emojis (Unicode ranges)
    text = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');

    // 9. Remove remaining raw URLs (e.g. http://...)
    text = text.replace(/https?:\/\/\S+/g, '');

    // 10. Fix Pronunciation for "ligavozic"
    // Force hard 'z' by breaking the 'zi' digraph or using phonetic spelling
    text = text.replace(/ligavozic/gi, 'liga vozic');

    // 11. Cleanup Punctuation and Whitespace
    // Fix double spaces or spaces before punctuation
    text = text.replace(/\s+([,.])/g, '$1');
    // Collapse multiple newlines to avoid long pauses
    text = text.replace(/\n{3,}/g, '\n\n');

    return text.trim();
}

// Serves the admin page for Q&A logs
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Returns Q&A logs as JSON
app.get('/api/qa-logs', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 500, 5000);
        const offset = parseInt(req.query.offset) || 0;
        const result = await getQALogs(limit, offset);
        res.json(result);
    } catch (error) {
        console.error("QA Logs Route Error:", error);
        res.status(500).json({ error: 'Failed to fetch QA logs' });
    }
});

// Diagnostic: lists distinct audience values in the chunks table with counts.
app.get('/api/audiences', async (req, res) => {
    try {
        res.json(await getAudienceCounts());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Diagnostic: tests eWay-CRM login and reports the raw result.
app.get('/api/eway/test', async (req, res) => {
    try {
        const sessionId = await ewayLogin();
        res.json({ ok: true, sessionId });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Diagnostic: dumps all eWay-CRM enum (dropdown) option values.
app.get('/api/eway/enums', async (req, res) => {
    try {
        const enums = await ewayCall('GetEnumValues', {
            transmitObject: {},
            includeForeignKeys: false,
            includeRelations: false
        });
        res.json({ ok: true, enums });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Diagnostic: dumps eWay-CRM field schema for Journal + SocialServices.
app.get('/api/eway/fields', async (req, res) => {
    try {
        const journal = await ewayCall('GetAdditionalFields', { objectTypeName: 'Journal' });
        const social = await ewayCall('GetAdditionalFields', { objectTypeName: 'SocialServices' });
        res.json({ ok: true, journal, social });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// One-shot: clears the forced password change by logging in with newPasswordHash.
// Hit ONCE with ?new=<NEW_PASSWORD>, then update EWAY_PASSWORD in Railway to the new value.
app.get('/api/eway/change-password', async (req, res) => {
    try {
        const newPass = req.query.new;
        if (!newPass || newPass.length < 8) {
            return res.status(400).json({ ok: false, error: 'Pass ?new=<password> (min 8 chars).' });
        }
        const crypto = require('crypto');
        const fetch = require('node-fetch');
        const cfg = require('./config').eway;
        if (!cfg.username || !cfg.password) {
            return res.status(500).json({ ok: false, error: 'EWAY_USERNAME or EWAY_PASSWORD not set.' });
        }
        const md5 = s => crypto.createHash('md5').update(s, 'utf8').digest('hex');
        const r = await fetch(cfg.serviceUrl.replace(/\/+$/, '') + '/API.svc/LogIn', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userName: cfg.username,
                passwordHash: md5(cfg.password),
                newPasswordHash: md5(newPass),
                appVersion: 'AV_001',
                clientMachineIdentifier: 'liga-qa-server',
                clientMachineName: 'liga-qa-server'
            })
        });
        const data = await r.json();
        res.json({ httpStatus: r.status, response: data });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Diagnostic: dumps real Poradna Journal records WITH relations.
// Confirms the Type column name, the Customer-relation format, and contact GUIDs.
app.get('/api/eway/journal-sample', async (req, res) => {
    try {
        const fetch = require('node-fetch');
        const cfg = require('./config').eway;
        const sid = await ewayLogin();
        const base = cfg.serviceUrl.replace(/\/+$/, '');
        const out = {};
        for (const fileAs of ['Anonym, Žena', 'Anonym, žena', 'Anonym, Muž', 'Anonym, muž', 'Anonym']) {
            const r = await fetch(`${base}/API.svc/SearchContacts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: sid,
                    transmitObject: { FileAs: fileAs },
                    includeForeignKeys: false,
                    includeRelations: false
                })
            });
            const data = await r.json();
            const rows = Array.isArray(data.Data) ? data.Data : [];
            out[fileAs] = {
                ReturnCode: data.ReturnCode,
                count: rows.length,
                matches: rows.slice(0, 10).map(c => ({ ItemGUID: c.ItemGUID, FileAs: c.FileAs }))
            };
        }
        res.json({ ok: true, out });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Diagnostic: discovers everything needed to fully populate a Poradna journal —
// Additional-Field column names, the enum value GUIDs for the 5 dropdowns, and
// the "Sociální služby 2026" project GUID. Throwaway; delete once baked in.
app.get('/api/eway/schema', async (req, res) => {
    try {
        const fetch = require('node-fetch');
        const cfg = require('./config').eway;
        const base = cfg.serviceUrl.replace(/\/+$/, '');
        const sid = await ewayLogin();
        const raw = async (method, body) => {
            const r = await fetch(`${base}/API.svc/${method}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: sid, ...body })
            });
            const text = await r.text();
            try { return JSON.parse(text); } catch { return { raw: text }; }
        };

        // 1) Additional-field definitions for the Journal module.
        const af = await raw('GetAdditionalFields', { objectTypeName: 'Journal' });
        const afDefs = (af.Data || af.AdditionalFields || []).map(f => ({
            FieldName: f.FieldName || f.ColumnName || f.InternalName,
            Name: f.Name || f.FileAs,
            Cs: f.Cs, En: f.En,
            DataType: f.DataType || f.Type,
            EnumTypeName: f.EnumTypeName || f.EnumType,
            Guid: f.ItemGUID || f.Guid
        }));

        // 2) All enum values; filter to the labels we need to map to GUIDs.
        const wanted = ['telefon', 'ambulant', 'zdravotn', 'chudob', 'stabilizac'];
        const enums = await raw('GetEnumValues', { transmitObject: {}, includeForeignKeys: false, includeRelations: false });
        const enumRows = (enums.Data || []).map(e => ({
            EnumType: e.EnumType || e.EnumTypeName,
            ItemGUID: e.ItemGUID,
            En: e.En, Cs: e.Cs, FileAs: e.FileAs
        }));
        const enumMatches = enumRows.filter(e => {
            const hay = `${e.En || ''} ${e.Cs || ''} ${e.FileAs || ''}`.toLowerCase();
            return wanted.some(w => hay.includes(w));
        });

        // 3) The superior project "Sociální služby 2026".
        const projOut = {};
        for (const q of ['Sociální služby 2026', 'Sociální služby', 'Sociln', 'služby 2026']) {
            const p = await raw('SearchProjects', { transmitObject: { FileAs: q }, includeForeignKeys: false, includeRelations: false });
            projOut[q] = { ReturnCode: p.ReturnCode, matches: (p.Data || []).slice(0, 10).map(x => ({ ItemGUID: x.ItemGUID, FileAs: x.FileAs })) };
        }

        res.json({
            ok: true,
            journalAdditionalFields: afDefs,
            afReturnCode: af.ReturnCode,
            enumMatches,
            enumTotal: enumRows.length,
            projects: projOut
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Diagnostic: builds ONE complete Poradna journal (all 17 fields), reads it
// back, and reports pass/fail per field, then deletes it. Learns the exact
// write format for combo/multi-select AFs and the project relation by copying
// a real "donor" record (read shape != write shape), so nothing is guessed.
// Throwaway: delete once logQA is baked and verified.
app.get('/api/eway/fulltest', async (req, res) => {
    // Known GUIDs (confirmed via /api/eway/schema).
    const POR = 'd88bc4e5-23b6-40c3-b592-7025c2a62188';
    const FEMALE = '358f0e1b-1345-11e9-9313-b0fc3636a08b';
    const PROJECT = '8659c180-d43a-11f0-8dee-70d8233eee18'; // Sociální služby 2026
    const FORMA = 'a1618af4-4116-4c1e-b2ed-759e7c405e9e';     // ambulantní (af_41)
    const CILOVA = 'cae0f7df-6d07-4c85-8835-8b700b9b801f';    // osoba se ZP (_af_79)
    const SOCPOT = '2532f1c2-dbab-452e-a921-a3c7df101beb';    // ohrožení chudobou (_af_80)
    const OBLAST = 'cb5b92d1-ba51-4068-8ce7-45bf4f204586';    // Základní stabilizace (_af_106)
    const TEL_CANDIDATES = ['efdd0548-0d7b-4764-b7e0-bfb0a9776984', '0eec1508-5530-4a98-abd9-d6a5cccff20f'];
    try {
        const fetch = require('node-fetch');
        const cfg = require('./config').eway;
        const base = cfg.serviceUrl.replace(/\/+$/, '');
        const sid = await ewayLogin();
        const raw = async (method, body) => {
            const r = await fetch(`${base}/API.svc/${method}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: sid, ...body })
            });
            const text = await r.text();
            try { return JSON.parse(text); } catch { return { raw: text }; }
        };
        const lc = s => String(s == null ? '' : s).toLowerCase();
        // Substitute my target GUID into whatever shape the donor used.
        const mimic = (donorVal, myGuid) => {
            if (Array.isArray(donorVal)) {
                if (donorVal.length && typeof donorVal[0] === 'object') {
                    const k = Object.keys(donorVal[0]).find(x => /guid/i.test(x)) || 'ItemGUID';
                    return [{ [k]: myGuid }];
                }
                return [myGuid];
            }
            return myGuid; // plain string GUID
        };

        // --- Donor: a real Poradna record with these fields populated. ---
        const search = await raw('SearchJournals', {
            transmitObject: { TypeEn: POR }, includeForeignKeys: true, includeRelations: true
        });
        const rows = Array.isArray(search.Data) ? search.Data : [];
        const KEYS = ['af_50', 'af_41', '_af_79', '_af_80', '_af_106'];
        const donor = rows
            .map(j => ({ j, n: KEYS.filter(k => j[k]).length }))
            .sort((a, b) => b.n - a.n)[0] || { j: {} };
        const dj = donor.j;
        const donorShapes = {};
        for (const k of [...KEYS, 'EventStart']) donorShapes[k] = dj[k] ?? null;
        // Resolve the right telefonický GUID: match the donor's af_50 if present.
        let typKontaktu = TEL_CANDIDATES[0];
        if (dj.af_50 && TEL_CANDIDATES.map(lc).includes(lc(dj.af_50))) typKontaktu = dj.af_50;
        // Donor project relation (to copy RelationType/direction). Confirmed
        // from live samples: SUPERIORITEM, DifferDirection true. Scan all rows.
        const donorProjRel = rows.map(j => (j.Relations || []).find(r => lc(r.ForeignFolderName) === 'projects')).find(Boolean)
            || { RelationType: 'SUPERIORITEM', DifferDirection: true };

        // --- Build the full journal ---
        const now = new Date();
        const end = new Date(now.getTime() + (15 + Math.floor(Math.random() * 21)) * 60000);
        const iso = d => d.toISOString().replace(/\.\d{3}Z$/, '');
        const title = 'ZZ FULLTEST kontrola';
        const to = {
            FileAs: title, Subject: title, Note: 'Testovací odpověď poradny.',
            TypeEn: POR,
            EventStart: iso(now), EventEnd: iso(end),
            af_55: 1, af_54: 0,                 // Kontakt počet / Intervence počet
            af_50: typKontaktu, af_41: FORMA,   // Typ kontaktu / Forma (combos)
            _af_79: mimic(dj._af_79, CILOVA),
            _af_80: mimic(dj._af_80, SOCPOT),
            _af_106: mimic(dj._af_106, OBLAST),
            af_95: true, af_130: true, af_139: false // Prvokontakt / Zákl. poradenství / Zpětná vazba
        };
        const created = await raw('SaveJournal', { transmitObject: to });
        const guid = created.Guid;
        if (!guid) return res.json({ ok: false, error: 'SaveJournal returned no Guid', created, donorShapes });

        const saveRel = (foreignGuid, foreignFolder, relType, differ) => raw('SaveRelation', {
            transmitObject: { ItemGUID1: guid, FolderName1: 'Journal', ItemGUID2: foreignGuid, FolderName2: foreignFolder, RelationType: relType, DifferDirection: differ }
        });
        const relContact = await saveRel(FEMALE, 'Contacts', 'CONTACT', true);
        const relProject = await saveRel(PROJECT, 'Projects', donorProjRel.RelationType, donorProjRel.DifferDirection !== false);

        // --- Read back & verify ---
        const back = await raw('SearchJournals', { transmitObject: { ItemGUID: guid }, includeForeignKeys: true, includeRelations: true });
        const item = (back.Data || [])[0] || {};
        const rels = item.Relations || [];
        const hasRel = (folder, fguid) => rels.some(r => lc(r.ForeignFolderName) === folder && lc(r.ForeignItemGUID) === lc(fguid));
        const contains = (val, guid) => lc(JSON.stringify(val)).includes(lc(guid));
        const verdict = {
            TypeEn: item.TypeEn === POR,
            Subject: !!item.Subject,
            Note: !!item.Note,
            EventStart: !!item.EventStart,
            EventEnd: !!item.EventEnd,
            af_55_kontaktPocet: Number(item.af_55) === 1,
            af_54_intervencePocet: Number(item.af_54) === 0,
            af_50_typKontaktu: contains(item.af_50, typKontaktu),
            af_41_forma: contains(item.af_41, FORMA),
            _af_79_cilovaSkupina: contains(item._af_79, CILOVA),
            _af_80_socPotrebnost: contains(item._af_80, SOCPOT),
            _af_106_oblastPotreb: contains(item._af_106, OBLAST),
            af_95_prvokontakt: item.af_95 === true || item.af_95 === 1,
            af_130_zaklPoradenstvi: item.af_130 === true || item.af_130 === 1,
            af_139_zpetnaVazba: item.af_139 === false || item.af_139 === 0 || item.af_139 == null,
            contactRelation: hasRel('contacts', FEMALE),
            projectRelation: hasRel('projects', PROJECT)
        };
        const allPass = Object.values(verdict).every(Boolean);

        const del = await raw('SaveJournal', { transmitObject: { ItemGUID: guid, Deleted: true } });
        res.json({
            ok: true, allPass, verdict,
            usedTypKontaktu: typKontaktu,
            projectRelType: donorProjRel.RelationType,
            donorGuid: dj.ItemGUID || null,
            donorShapes,
            saves: { create: created.ReturnCode, relContact: relContact.ReturnCode, relProject: relProject.ReturnCode, cleanup: del.ReturnCode },
            readBackAf: Object.fromEntries(Object.keys(item).filter(k => /^_?af_\d+/.test(k) && item[k] != null && item[k] !== '').map(k => [k, item[k]])),
            relationsBack: rels
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Handles TTS requests
app.post('/tts', async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: 'No text provided' });

        // Clean the text specifically for audio output
        const cleanedText = cleanTextForTTS(text);

        // Limit text length to prevent huge costs/latency
        const safeText = cleanedText.substring(0, 5000);

        if (safeText.length === 0) {
            return res.status(400).json({ error: 'Text is empty after cleaning' });
        }

        const audioBuffer = await getTTS(safeText);

        res.set({
            'Content-Type': 'audio/mpeg',
            'Content-Length': audioBuffer.length
        });
        res.send(audioBuffer);
    } catch (error) {
        console.error("TTS Route Error:", error);
        res.status(500).json({ error: 'TTS generation failed' });
    }
});

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
});
