/* ═══════════════════════════════════════════════
   EDITOR SETUP
═══════════════════════════════════════════════ */
let cy;
let errorMarker = null; // CodeMirror text-marker for precise char highlight
let errorLineNum = null; // Track error line number to reliably clear it

const errorBox = document.getElementById('error-box');
const generateBtn = document.getElementById('generate-btn');
const graphCtrls = document.querySelectorAll('.graph-ctrl');
const statsBar = document.getElementById('stats-bar');

const editor = CodeMirror.fromTextArea(document.getElementById('json-input'), {
    mode: "application/json",
    theme: "neo",
    lineNumbers: true,
    lineWrapping: false,
    tabSize: 2,
    extraKeys: { "Ctrl-Enter": () => !generateBtn.disabled && render() }
});

/* ── Accurate JSON error position ── */
function getErrorPosition(content, errorMsg) {
    // Try "at position N" (V8 / most browsers)
    let match = errorMsg.match(/at position (\d+)/);
    if (match) {
        let charIdx = parseInt(match[1]);
        // JSON.parse reports the position of the *unexpected* character.
        // If that character is whitespace we may need to walk back to the
        // last non-whitespace to find the actual problem site.
        // We clamp to valid range.
        charIdx = Math.max(0, Math.min(charIdx, content.length - 1));
        return editor.posFromIndex(charIdx);
    }
    // Fallback: "line N column M" (Firefox / Safari)
    match = errorMsg.match(/line (\d+) column (\d+)/);
    if (match) {
        return { line: parseInt(match[1]) - 1, ch: parseInt(match[2]) - 1 };
    }
    return null;
}

editor.on("change", () => {
    const content = editor.getValue().trim();

    // Clear previous error decorations
    if (errorLineNum !== null) {
        editor.removeLineClass(errorLineNum, "background", "error-line");
        errorLineNum = null;
    }
    if (errorMarker) { errorMarker.clear(); errorMarker = null; }

    if (!content) {
        generateBtn.disabled = true;
        showError(null);
        return;
    }

    try {
        JSON.parse(content);
        generateBtn.disabled = false;
        showError(null);
    } catch (e) {
        generateBtn.disabled = true;
        const pos = getErrorPosition(editor.getValue(), e.message);
        if (pos) {
            // Highlight the entire line
            editor.addLineClass(pos.line, "background", "error-line");
            errorLineNum = pos.line;
            // And mark the exact character(s) with a stronger highlight
            const endPos = { line: pos.line, ch: pos.ch + 1 };
            errorMarker = editor.markText(
                pos, endPos,
                { className: "error-char" }
            );
            showError(`JSON Error at line ${pos.line + 1}, col ${pos.ch + 1}`);
        } else {
            showError("Invalid JSON structure");
        }
    }
});

function showError(msg) {
    if (msg) {
        errorBox.textContent = msg;
        errorBox.classList.add('visible');
    } else {
        errorBox.textContent = '';
        errorBox.classList.remove('visible');
    }
}

/* ═══════════════════════════════════════════════
   ACCESS TYPE → COLOR / SEVERITY
═══════════════════════════════════════════════ */
function accessColor(type) {
    const t = (type || '').toUpperCase();
    if (t === 'ALL') return '#dc3545'; // full scan – bad
    if (t === 'INDEX') return '#f59e0b'; // index scan
    if (['RANGE', 'REF', 'REF_OR_NULL',
        'FULLTEXT'].includes(t)) return '#10b981'; // good range
    if (['EQ_REF', 'CONST', 'SYSTEM'].includes(t)) return '#3b82f6'; // optimal
    return '#8b5cf6';                                          // derived/other
}

/* ── accessBg: light tint for node background ── */
function accessBg(type) {
    const t = (type || '').toUpperCase();
    if (t === 'ALL') return '#fff5f5';
    if (t === 'INDEX') return '#fffbeb';
    if (['RANGE', 'REF', 'REF_OR_NULL', 'FULLTEXT'].includes(t)) return '#f0fdf4';
    if (['EQ_REF', 'CONST', 'SYSTEM'].includes(t)) return '#eff6ff';
    return '#faf5ff';
}

/* ── PARSE: recursive tree builder for operations and tables ── */
function parseData(rawJson) {
    const data = JSON.parse(rawJson);
    const elements = [];
    let tableSeq = 1;
    let opSeq = 1;
    let totalRows = 0;
    const stats = { nodes: 0, fullScans: 0 };

    function p(k) { return k.padEnd(9); }   // pad key column to 9 chars

    function getRows(t) {
        return parseFloat(t.rows_produced_per_join ?? t.rows_examined_per_scan ?? 0);
    }

    function walk(obj, key = null) {
        if (!obj || typeof obj !== 'object') return null;

        let actualObj = obj;
        let actualKey = key;

        if (!actualKey) {
            const keys = Object.keys(obj);
            if (keys.length === 1) {
                const k = keys[0];
                if (['query_block', 'nested_loop', 'hash_join', 'grouping_operation', 'ordering_operation', 'duplicates_removal', 'union_result', 'buffer_result', 'table'].includes(k)) {
                    actualKey = k;
                    actualObj = obj[k];
                }
            }
        }

        // CASE 1: Table block
        if (actualKey === 'table') {
            const t = actualObj;
            const nodeId = `table_${tableSeq++}`;
            const rows = getRows(t);
            totalRows += rows;
            stats.nodes++;
            if ((t.access_type || '').toUpperCase() === 'ALL') stats.fullScans++;

            const name = t.table_name || `<derived>`;
            const ref = Array.isArray(t.ref) ? t.ref.join(', ') : (t.ref || '—');
            const possible = t.possible_keys
                ? (Array.isArray(t.possible_keys) ? t.possible_keys : [t.possible_keys]).join(', ')
                : '—';
            const extra = t.used_key_parts ? t.used_key_parts.join(', ') : '—';
            const using = t.using_index ? 'Index' : t.using_filesort ? 'Filesort' : t.using_temporary ? 'Temp' : '—';
            const cost = t.cost_info?.read_cost || t.read_cost || '—';
            const rowFmt = rows > 0 ? Math.round(rows).toLocaleString() : '0';

            const label = [
                `Table: ${name}`,
                `──────────────────`,
                `${p('Access')}${t.access_type || 'N/A'}`,
                `${p('Key')}${t.key || 'None'}`,
                `${p('Key Len')}${t.key_length || '—'}`,
                `${p('Ref')}${ref}`,
                `${p('Rows')}${rowFmt}`,
                `${p('Filtered')}${t.filtered !== undefined ? t.filtered + '%' : '—'}`,
                `${p('Cost')}${cost}`,
                `${p('Extra')}${extra}`,
                `${p('Possible')}${possible}`,
                `${p('Using')}${using}`,
            ].join('\n');

            elements.push({
                data: {
                    id: nodeId, label, rows, IsOp: false,
                    color: accessColor(t.access_type),
                    bg: accessBg(t.access_type)
                }
            });

            // Walk any nested properties of the table block (like materialized_from_subquery or attached_subqueries)
            Object.entries(t).forEach(([k, v]) => {
                if (v && typeof v === 'object') {
                    const subqueryRes = walk(v, k);
                    if (subqueryRes) {
                        if (subqueryRes.id) {
                            elements.push({
                                data: { source: subqueryRes.id, target: nodeId, rows: subqueryRes.rows }
                            });
                        } else if (Array.isArray(subqueryRes)) {
                            subqueryRes.forEach(res => {
                                if (res && res.id) {
                                    elements.push({
                                        data: { source: res.id, target: nodeId, rows: res.rows }
                                    });
                                }
                            });
                        }
                    }
                }
            });

            return { id: nodeId, rows };
        }

        // CASE 2: Structural operation blocks
        let opName = null;
        let opDetails = '';
        let targetObj = null;
        let opBg = '#ffffff';
        let opColor = '#64748b';

        if (actualKey === 'query_block') {
            opName = `Query Block #${actualObj.select_id || 1}`;
            targetObj = actualObj;
            opBg = '#e2e8f0';
        } else if (actualKey === 'nested_loop') {
            opName = 'Nested Loop';
            targetObj = actualObj;
        } else if (actualKey === 'hash_join') {
            opName = 'Hash Join';
            targetObj = actualObj;
        } else if (actualKey === 'grouping_operation') {
            opName = 'GROUP';
            targetObj = actualObj;
            opDetails = 'tmp table, filesort';
            opColor = '#dc3545';
        } else if (actualKey === 'ordering_operation') {
            opName = 'SORT';
            targetObj = actualObj;
        } else if (actualKey === 'duplicates_removal') {
            opName = 'Duplicates Removal';
            targetObj = actualObj;
        } else if (actualKey === 'union_result') {
            opName = 'UNION';
            targetObj = actualObj;
        } else if (actualKey === 'buffer_result') {
            opName = 'BUFFER';
            targetObj = actualObj;
        }

        if (opName) {
            const opId = `op_${opSeq++}`;
            const childResults = [];

            if (Array.isArray(targetObj)) {
                targetObj.forEach(child => {
                    const res = walk(child);
                    if (res) {
                        if (Array.isArray(res)) {
                            childResults.push(...res);
                        } else {
                            childResults.push(res);
                        }
                    }
                });
            } else {
                Object.entries(targetObj).forEach(([k, v]) => {
                    if (v && typeof v === 'object') {
                        const res = walk(v, k);
                        if (res) {
                            if (Array.isArray(res)) {
                                childResults.push(...res);
                            } else {
                                childResults.push(res);
                            }
                        }
                    }
                });
            }

            let opRows = 0;
            childResults.forEach(res => {
                opRows += res.rows || 0;
            });

            elements.push({
                data: {
                    id: opId,
                    label: opDetails ? `${opName}\n(${opDetails})` : opName,
                    IsOp: true,
                    bg: opBg,
                    color: opColor,
                    rows: opRows
                }
            });

            childResults.forEach(res => {
                elements.push({
                    data: { source: res.id, target: opId, rows: res.rows || 0 }
                });
            });

            return { id: opId, rows: opRows };
        }

        // CASE 3: Passthrough container
        if (Array.isArray(actualObj)) {
            const results = [];
            actualObj.forEach(item => {
                const res = walk(item);
                if (res) {
                    if (Array.isArray(res)) {
                        results.push(...res);
                    } else {
                        results.push(res);
                    }
                }
            });
            return results.length > 0 ? results : null;
        } else {
            const results = [];
            Object.entries(actualObj).forEach(([k, v]) => {
                if (v && typeof v === 'object') {
                    const res = walk(v, k);
                    if (res) {
                        if (Array.isArray(res)) {
                            results.push(...res);
                        } else {
                            results.push(res);
                        }
                    }
                }
            });
            if (results.length === 1) return results[0];
            if (results.length > 1) return results;
            return null;
        }
    }

    walk(data);
    return { elements, totalRows, stats };
}

/* ── RENDER ── */
function render() {
    const raw = editor.getValue();
    if (!raw.trim()) return;

    let parsed;
    try { parsed = parseData(raw); }
    catch (e) { showError('Parse error: ' + e.message); return; }

    const { elements, totalRows, stats } = parsed;
    if (elements.length === 0) { showError('No table data found in JSON'); return; }
    showError(null);

    if (cy) cy.destroy();

    cy = cytoscape({
        container: document.getElementById('cy'),
        elements,
        style: [
            {
                selector: 'node',
                style: {
                    'shape': (n) => n.data('IsOp') ? 'diamond' : 'roundrectangle',
                    'background-color': 'data(bg)',
                    'border-color': 'data(color)',
                    'border-width': 2,
                    'label': 'data(label)',
                    'color': '#1e293b',
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'font-size': (n) => n.data('IsOp') ? '12px' : '11px',
                    'font-family': "Consolas, Menlo, 'Courier New', monospace",
                    'text-wrap': 'wrap',
                    'text-max-width': '600px',
                    'line-height': 1.45,
                    'width': (n) => n.data('IsOp') ? 80 : 'label',
                    'height': (n) => n.data('IsOp') ? 80 : 'label',
                    'padding': '12px',
                }
            },
            {
                selector: 'edge',
                style: {
                    'width': (e) => Math.max(2, totalRows > 0 ? (e.data('rows') / totalRows) * 14 : 2),
                    'label': (e) => totalRows > 0 ? `${Math.round(e.data('rows')).toLocaleString()} rows` : '',
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier',
                    'font-size': '10px',
                    'color': '#64748b',
                    'line-color': '#94a3b8',
                    'target-arrow-color': '#94a3b8',
                    'text-margin-y': -12,
                    'text-background-color': '#f0f2f5',
                    'text-background-opacity': 0.9,
                    'text-background-padding': '3px',
                }
            }
        ],
        layout: {
            name: 'dagre',
            rankDir: 'LR',
            padding: 60,
            spacingFactor: 1.3,
            nodeSep: 50,
            rankSep: 130,
        }
    });

    cy.fit(undefined, 60);

    statsBar.innerHTML = `
                <div class="stat-chip">Nodes: <strong>${stats.nodes}</strong></div>
                <div class="stat-chip">Full Scans: <strong style="color:${stats.fullScans > 0 ? '#dc3545' : '#16a34a'}">${stats.fullScans}</strong></div>
                <div class="stat-chip">Total Rows: <strong>${Math.round(totalRows).toLocaleString()}</strong></div>
            `;

    graphCtrls.forEach(btn => btn.disabled = false);
}

/* ═══════════════════════════════════════════════
   BUTTON WIRING
═══════════════════════════════════════════════ */
generateBtn.addEventListener('click', render);

document.getElementById('clear-btn').addEventListener('click', () => {
    editor.setValue("");
    if (cy) { cy.destroy(); cy = null; }
    generateBtn.disabled = true;
    graphCtrls.forEach(btn => btn.disabled = true);
    showError(null);
    statsBar.innerHTML = '';
});

document.getElementById('reset-btn').addEventListener('click', () => cy && cy.fit(undefined, 60));

document.getElementById('export-btn').addEventListener('click', () => {
    if (!cy) return;
    const link = document.createElement('a');
    link.href = cy.png({ full: true, bg: '#f0f2f5', scale: 2 });
    link.download = `mysql_execution_plan_${Date.now()}.png`;
    link.click();
});
