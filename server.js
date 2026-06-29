try {
    require('dotenv').config();
} catch (e) {
    // Railway handles variables natively; this prevents the crash
}

const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { search } = require('./search');
const { getTTS } = require('./ai-client');
const { getQALogs, getAudienceCounts } = require('./database');
const { login: ewayLogin, callMethod: ewayCall, getLastLog: ewayGetLastLog } = require('./eway-crm');
const adminChunks = require('./admin-chunks');

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
// back, and reports pass/fail per field, then deletes it. Nothing is guessed:
// - Additional fields are written nested under `AdditionalFields` and read back
//   from `item.AdditionalFields` (confirmed via the eWay-CRM API sample).
// - Each dropdown value is resolved deterministically: the target Czech label
//   is matched only within the enum type actually bound to that field (read
//   from GetAdditionalFields), so e.g. the correct "telefonický" is chosen.
// Throwaway: delete once logQA is baked and verified.
app.get('/api/eway/fulltest', async (req, res) => {
    const POR = 'd88bc4e5-23b6-40c3-b592-7025c2a62188';
    const FEMALE = '358f0e1b-1345-11e9-9313-b0fc3636a08b';
    const PROJECT = '8659c180-d43a-11f0-8dee-70d8233eee18'; // Sociální služby 2026
    // Each combo/multi-select field → the exact Czech label to select.
    const ENUM_FIELDS = [
        { field: 'af_50', label: 'telefonický', multi: false },               // Typ kontaktu
        { field: 'af_41', label: 'ambulantní', multi: false },                // Forma
        { field: '_af_79', label: 'osoba se zdravotním postižením', multi: true }, // Cílová skupina
        { field: '_af_80', label: 'ohrožení chudobou', multi: true },         // Sociální potřebnost
        { field: '_af_106', label: 'základní stabilizace', multi: true }      // Por Oblast potřeb
    ];
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
        const isGuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v);

        // --- Resolve dropdown GUIDs deterministically ---
        // 1) AF definitions → each field's set of candidate enum-type GUIDs.
        const afResp = await raw('GetAdditionalFields', { objectTypeName: 'Journal' });
        const afDefs = afResp.Data || afResp.AdditionalFields || [];
        const defByField = {};
        for (const d of afDefs) defByField[d.FieldName || d.ColumnName] = d;
        // 2) All enum values, indexed for label+enum-type matching.
        const enumResp = await raw('GetEnumValues', { transmitObject: {} });
        const enumRows = (enumResp.Data || []).map(e => ({
            EnumType: e.EnumType || e.EnumTypeName,
            ItemGUID: e.ItemGUID,
            names: [e.En, e.Cs, e.FileAs].map(lc)
        }));
        const resolve = (field, label) => {
            const def = defByField[field] || {};
            const typeGuids = new Set(Object.values(def).filter(isGuid).map(lc)); // enum-type lives in the def
            const byLabel = enumRows.filter(e => e.names.includes(lc(label)));
            const bound = byLabel.find(e => typeGuids.has(lc(e.EnumType)));
            const chosen = bound || byLabel[0] || null;
            return { guid: chosen && chosen.ItemGUID, matchedByType: !!bound, candidates: byLabel.length, defGuids: [...typeGuids] };
        };
        const resolved = {};
        for (const f of ENUM_FIELDS) resolved[f.field] = resolve(f.field, f.label);

        // --- Build AdditionalFields (nested) ---
        // The `_af_` prefix is a DB-column convention; in the AdditionalFields
        // object the key drops the leading underscore (confirmed: read-back
        // keys are all `af_NN`, and the eWay sample writes `af_29 => array()`).
        const afKey = field => field.replace(/^_/, '');
        const AdditionalFields = { af_55: 1, af_54: 0, af_95: true, af_130: true, af_139: false };
        for (const f of ENUM_FIELDS) {
            const g = resolved[f.field].guid;
            AdditionalFields[afKey(f.field)] = f.multi ? [g] : g;
        }

        const now = new Date();
        const end = new Date(now.getTime() + (15 + Math.floor(Math.random() * 21)) * 60000);
        const iso = d => d.toISOString().replace(/\.\d{3}Z$/, '');
        const title = 'ZZ FULLTEST kontrola';
        // Step 1: create with Type (Poradna) FIRST — the Poradna-specific
        // DataType-8 fields only become writable once the Type is set.
        const step1 = await raw('SaveJournal', { transmitObject: {
            FileAs: title, Subject: title, Note: 'Testovací odpověď poradny.',
            TypeEn: POR, EventStart: iso(now), EventEnd: iso(end)
        } });
        const guid = step1.Guid;
        if (!guid) return res.json({ ok: false, error: 'SaveJournal (step1) returned no Guid', step1, resolved });
        // Step 2: now that the record is typed Poradna, set the AdditionalFields.
        const step2 = await raw('SaveJournal', { transmitObject: { ItemGUID: guid, TypeEn: POR, AdditionalFields } });
        const created = step1;

        const saveRel = (foreignGuid, foreignFolder, relType) => raw('SaveRelation', {
            transmitObject: { ItemGUID1: guid, FolderName1: 'Journal', ItemGUID2: foreignGuid, FolderName2: foreignFolder, RelationType: relType, DifferDirection: true }
        });
        const relContact = await saveRel(FEMALE, 'Contacts', 'CONTACT');
        const relProject = await saveRel(PROJECT, 'Projects', 'SUPERIORITEM');

        // --- Read back & verify (AFs come back nested) ---
        const back = await raw('SearchJournals', { transmitObject: { ItemGUID: guid }, includeForeignKeys: true, includeRelations: true });
        const item = (back.Data || [])[0] || {};
        const AF = item.AdditionalFields || {};
        const rels = item.Relations || [];
        const hasRel = (folder, fguid) => rels.some(r => lc(r.ForeignFolderName) === folder && lc(r.ForeignItemGUID) === lc(fguid));
        const has = (val, guid) => guid && lc(JSON.stringify(val)).includes(lc(guid));
        const verdict = {
            TypeEn: item.TypeEn === POR,
            FileAs: !!item.FileAs,
            Note: !!item.Note,
            EventStart: !!item.EventStart,
            EventEnd: !!item.EventEnd,
            af_55_kontaktPocet: Number(AF.af_55) === 1,
            af_54_intervencePocet: Number(AF.af_54) === 0,
            af_50_typKontaktu: has(AF.af_50, resolved.af_50.guid),
            af_41_forma: has(AF.af_41, resolved.af_41.guid),
            _af_79_cilovaSkupina: has(AF.af_79, resolved._af_79.guid),
            _af_80_socPotrebnost: has(AF.af_80, resolved._af_80.guid),
            _af_106_oblastPotreb: has(AF.af_106, resolved._af_106.guid),
            af_95_prvokontakt: AF.af_95 === true || AF.af_95 === 1,
            af_130_zaklPoradenstvi: AF.af_130 === true || AF.af_130 === 1,
            af_139_zpetnaVazba: AF.af_139 === false || AF.af_139 === 0 || AF.af_139 == null,
            contactRelation: hasRel('contacts', FEMALE),
            projectRelation: hasRel('projects', PROJECT)
        };
        const allPass = Object.values(verdict).every(Boolean);

        // ?keep=1 leaves the record in eWay so the 3 DataType-8 dropdowns
        // (which SearchJournals can't read back) can be checked in the UI.
        const keep = req.query.keep === '1';
        const del = keep ? { ReturnCode: 'kept' } : await raw('SaveJournal', { transmitObject: { ItemGUID: guid, Deleted: true } });
        res.json({
            ok: true, allPass, verdict, resolved,
            keptForUiCheck: keep ? { guid, FileAs: title, openInEway: 'Find this journal in eWay and check Cílová skupina / Sociální potřebnost / Por Oblast potřeb' } : null,
            saves: { step1_type: step1.ReturnCode, step2_fields: step2.ReturnCode, relContact: relContact.ReturnCode, relProject: relProject.ReturnCode, cleanup: del.ReturnCode },
            readBackAdditionalFields: AF,
            readBackTopLevelAfKeys: Object.keys(item).filter(k => /^_?af_\d+/.test(k)),
            relationsBack: rels
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Diagnostic: hunts real Poradna journals for ones where the 3 DataType-8
// dropdowns are actually populated, and dumps their full raw structure so the
// real storage/format of those values can be seen (not guessed). Throwaway.
app.get('/api/eway/find-dropdowns', async (req, res) => {
    try {
        const fetch = require('node-fetch');
        const cfg = require('./config').eway;
        const base = cfg.serviceUrl.replace(/\/+$/, '');
        const sid = await ewayLogin();
        const r = await fetch(`${base}/API.svc/SearchJournals`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: sid,
                transmitObject: { TypeEn: 'd88bc4e5-23b6-40c3-b592-7025c2a62188' },
                includeForeignKeys: true, includeRelations: true
            })
        });
        const data = await r.json();
        const rows = Array.isArray(data.Data) ? data.Data : [];
        const nonEmpty = v => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
        const probe = j => {
            const AF = j.AdditionalFields || {};
            // Look both inside AdditionalFields and at top level, with and
            // without the underscore prefix, so wherever the value lives we see it.
            const keys = ['af_79', '_af_79', 'af_80', '_af_80', 'af_106', '_af_106'];
            const hitsAF = keys.filter(k => nonEmpty(AF[k]));
            const hitsTop = keys.filter(k => nonEmpty(j[k]));
            return { hitsAF, hitsTop };
        };
        const matches = [];
        for (const j of rows) {
            const p = probe(j);
            if (p.hitsAF.length || p.hitsTop.length) {
                matches.push({
                    ItemGUID: j.ItemGUID, FileAs: j.FileAs,
                    foundIn_AdditionalFields: p.hitsAF, foundIn_topLevel: p.hitsTop,
                    AdditionalFields: j.AdditionalFields || null,
                    af_topLevel: Object.fromEntries(Object.keys(j).filter(k => /^_?af_\d+/.test(k) && nonEmpty(j[k])).map(k => [k, j[k]])),
                    relationFolders: (j.Relations || []).map(x => `${x.ForeignFolderName}:${x.RelationType}`)
                });
            }
            if (matches.length >= 3) break;
        }
        // If nothing matched, dump one full raw record so we can see every key.
        const sampleRawKeys = rows.length ? Object.keys(rows[0]) : [];
        res.json({
            ok: true, totalPoradna: rows.length, matchCount: matches.length,
            matches,
            note: matches.length ? 'See foundIn_* for where the DataType-8 values live.' : 'No Poradna journal returned these 3 fields in the search response.',
            sampleRawKeys
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Diagnostic: runs the exact logQA step sequence but surfaces each step's
// outcome/error instead of swallowing it, so a production "nothing written"
// failure can be diagnosed. ?q=&a= to supply realistic text. Throwaway.
app.get('/api/eway/logqa-debug', async (req, res) => {
    const POR = 'd88bc4e5-23b6-40c3-b592-7025c2a62188';
    const steps = [];
    try {
        const q = req.query.q || 'Jak požádat o příspěvek na péči a co k tomu potřebuji doložit?';
        // Default to a LONG, realistic poradna answer (markdown, Czech, links,
        // emoji headers) to reproduce a production-sized Note. ?len= overrides.
        const len = parseInt(req.query.len, 10) || 4000;
        const para = 'Dobrý den, příspěvek na péči je dávka určená osobám, které potřebují pomoc jiné osoby. Žádost se podává na úřadu práce dle místa trvalého pobytu. K žádosti je třeba doložit doklad totožnosti a lékařské zprávy. ';
        let a = req.query.a;
        if (!a) {
            a = '# Odpověď\n\n';
            while (a.length < len) a += para;
            a += '\n\n* první bod\n* druhý bod\n\n---\n# 📥 Ke stažení\n\n* [Formulář](https://example.com/f.pdf)\n\n---\n# 📄 Zdroje\n\n1. [Zákon](https://example.com/zakon)\n2. [MPSV](https://example.com/mpsv)';
        }
        const title = (q || '').trim().split(/\s+/).filter(Boolean).slice(0, 3).join(' ') || 'Poradna';
        const start = new Date();
        const end = new Date(start.getTime() + 20 * 60000);
        const iso = d => d.toISOString().replace(/\.\d{3}Z$/, '');

        let journalGuid = null;
        try {
            const s1 = await ewayCall('SaveJournal', { transmitObject: { FileAs: title, Subject: title, Note: a, TypeEn: POR, EventStart: iso(start), EventEnd: iso(end) } });
            journalGuid = s1.Guid;
            steps.push({ step: 'step1_create', ok: true, ReturnCode: s1.ReturnCode, Guid: journalGuid });
        } catch (e) { steps.push({ step: 'step1_create', ok: false, error: e.message }); }

        if (journalGuid) {
            try {
                const s2 = await ewayCall('SaveJournal', { transmitObject: { ItemGUID: journalGuid, TypeEn: POR, AdditionalFields: {
                    af_50: 'efdd0548-0d7b-4764-b7e0-bfb0a9776984', af_41: 'a1618af4-4116-4c1e-b2ed-759e7c405e9e',
                    af_79: ['cae0f7df-6d07-4c85-8835-8b700b9b801f'], af_80: ['2532f1c2-dbab-452e-a921-a3c7df101beb'], af_106: ['cb5b92d1-ba51-4068-8ce7-45bf4f204586'],
                    af_95: true, af_130: true, af_139: false
                } } });
                steps.push({ step: 'step2_fields', ok: true, ReturnCode: s2.ReturnCode });
            } catch (e) { steps.push({ step: 'step2_fields', ok: false, error: e.message }); }

            for (const [fg, ff, rt] of [['358f0e1b-1345-11e9-9313-b0fc3636a08b', 'Contacts', 'CONTACT'], ['8659c180-d43a-11f0-8dee-70d8233eee18', 'Projects', 'SUPERIORITEM']]) {
                try {
                    const sr = await ewayCall('SaveRelation', { transmitObject: { ItemGUID1: journalGuid, FolderName1: 'Journal', ItemGUID2: fg, FolderName2: ff, RelationType: rt, DifferDirection: true } });
                    steps.push({ step: `relation_${ff}`, ok: true, ReturnCode: sr.ReturnCode });
                } catch (e) { steps.push({ step: `relation_${ff}`, ok: false, error: e.message }); }
            }
            await ewayCall('SaveJournal', { transmitObject: { ItemGUID: journalGuid, Deleted: true } }).catch(() => {});
        }
        res.json({ ok: true, allStepsOk: steps.every(s => s.ok), titleUsed: title, steps });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message, steps });
    }
});

// Diagnostic: shows the outcome of the most recent real logQA call. Ask a
// poradna question, then hit this to see whether eWay logging ran and its result.
app.get('/api/eway/last-log', (req, res) => {
    res.json({ ok: true, lastLog: ewayGetLastLog() });
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

// --- Admin Chunks API ---
// Turn any backend error into a plain-Czech message a non-technical user can
// act on, plus a short reference code. The full technical error is logged
// server-side under that code so Nik can trace it.
function adminError(res, e, action) {
    const ref = (Date.now().toString(36) + Math.random().toString(36).slice(2, 5)).slice(-6).toUpperCase();
    console.error(`[ADMIN ${action} ERR ${ref}]`, e && e.stack ? e.stack : e);
    const msg = ((e && e.message) || '').toLowerCase();
    let userMsg;
    if (msg.includes('quota') || msg.includes('429') || msg.includes('resource_exhausted') || msg.includes('rate limit')) {
        userMsg = 'Služba je momentálně přetížená. Zkuste to prosím za minutu znovu.';
    } else if (msg.includes('google') || msg.includes('embedding') || msg.includes('fetch') || msg.includes('network') ||
               msg.includes('timeout') || msg.includes('econn') || msg.includes('socket') ||
               msg.includes('503') || msg.includes('502') || msg.includes('500') || msg.includes('dimension')) {
        userMsg = 'Služba AI je dočasně nedostupná. Zkuste to prosím za chvíli znovu.';
    } else {
        userMsg = 'Došlo k technické chybě. Kontaktujte prosím Nika a uveďte kód níže.';
    }
    res.status(500).json({ error: userMsg, ref });
}

app.get('/api/admin/chunks', async (req, res) => {
    try {
        const { search, offset, limit, filters } = req.query;
        const filterArr = filters ? String(filters).split(',').filter(Boolean) : [];
        const result = await adminChunks.listChunks(search, parseInt(offset) || 0, parseInt(limit) || 50, filterArr);
        res.json(result);
    } catch (e) { adminError(res, e, 'list'); }
});

app.get('/api/admin/chunks/:id', async (req, res) => {
    try {
        const chunk = await adminChunks.getChunk(req.params.id);
        res.json(chunk);
    } catch (e) { adminError(res, e, 'get'); }
});

app.post('/api/admin/chunks', async (req, res) => {
    try {
        const chunk = await adminChunks.createChunk(req.body);
        res.json(chunk);
    } catch (e) { adminError(res, e, 'create'); }
});

app.put('/api/admin/chunks/:id', async (req, res) => {
    try {
        const chunk = await adminChunks.updateChunk(req.params.id, req.body);
        res.json(chunk);
    } catch (e) { adminError(res, e, 'update'); }
});

app.delete('/api/admin/chunks/:id', async (req, res) => {
    try {
        await adminChunks.deleteChunk(req.params.id);
        res.json({ ok: true });
    } catch (e) { adminError(res, e, 'delete'); }
});

app.get('/api/admin/chunks/:id/history', async (req, res) => {
    try {
        const history = await adminChunks.getHistory(req.params.id);
        res.json(history);
    } catch (e) { adminError(res, e, 'history'); }
});

app.post('/api/admin/chunks/:id/restore/:historyId', async (req, res) => {
    try {
        const chunk = await adminChunks.restoreChunk(req.params.id, req.params.historyId);
        res.json(chunk);
    } catch (e) { adminError(res, e, 'restore'); }
});

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
});

// Daily Facebook ingestion (posts + upcoming events). The script is incremental
// and idempotent — it embeds only new/changed items and exits cheaply when
// there's nothing new — so a daily run is safe. Runs in-process via cron and
// spawns the existing script so all its token/diff logic is reused unchanged.
// Disable with FB_CRON_DISABLED=true; only schedules when a token is available.
(() => {
    if (process.env.FB_CRON_DISABLED === 'true') {
        console.log('FB ingestion cron disabled (FB_CRON_DISABLED=true).');
        return;
    }
    const hasToken = !!process.env.FB_TOKEN || fs.existsSync(path.join(__dirname, 'fb-token.local'));
    if (!hasToken) {
        console.log('FB ingestion cron not scheduled: no FB token (set FB_TOKEN or fb-token.local).');
        return;
    }

    const cron = require('node-cron');
    const { spawn } = require('child_process');
    const SCHEDULE = process.env.FB_CRON_SCHEDULE || '0 5 * * *'; // daily ~05:00 server time
    let running = false;

    const runIngest = () => {
        if (running) { console.log('[fb-cron] previous run still going, skipping this tick.'); return; }
        running = true;
        console.log('[fb-cron] starting Facebook ingestion...');
        const child = spawn(process.execPath, [path.join(__dirname, 'scripts', 'ingest-facebook.js')], {
            cwd: __dirname,
            env: process.env
        });
        child.stdout.on('data', d => process.stdout.write(`[fb-cron] ${d}`));
        child.stderr.on('data', d => process.stderr.write(`[fb-cron] ${d}`));
        child.on('close', code => {
            running = false;
            console.log(`[fb-cron] ingestion finished (exit ${code}).`);
        });
        child.on('error', err => {
            running = false;
            console.error(`[fb-cron] failed to start ingestion: ${err.message}`);
        });
    };

    cron.schedule(SCHEDULE, runIngest);
    console.log(`FB ingestion cron scheduled (${SCHEDULE}).`);
})();
