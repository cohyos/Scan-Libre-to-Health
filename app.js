(function () {
    'use strict';

    // ==============================
    // State
    // ==============================
    let rawRows = [];
    let headerRow = [];
    let metadataLines = [];
    let processedRows = [];
    let delimiter = ',';

    // Column indices (0-based) — will be detected from headers
    let colTimestamp = 2;   // Device Timestamp
    let colHistoric = 4;    // Historic Glucose
    let colScan = 5;        // Scan Glucose

    // ==============================
    // DOM References
    // ==============================
    const $ = (id) => document.getElementById(id);

    const csvFileInput = $('csvFile');
    const fileUploadArea = $('fileUploadArea');
    const fileInfo = $('fileInfo');
    const formatSelect = $('formatSelect');
    const dateFormatSel = $('dateFormat');
    const step3 = $('step3');
    const step4 = $('step4');
    const step5 = $('step5');
    const dateFrom = $('dateFrom');
    const dateTo = $('dateTo');
    const processBtn = $('processBtn');
    const downloadBtn = $('downloadBtn');
    const healthBtn = $('healthBtn');
    const shortcutBtn = $('shortcutBtn');
    const statsEl = $('stats');
    const previewEl = $('preview');

    // ==============================
    // Event Listeners
    // ==============================
    csvFileInput.addEventListener('change', function (e) {
        var file = e.target.files[0];
        if (file) readFile(file);
    });

    fileUploadArea.addEventListener('dragover', function (e) {
        e.preventDefault();
        fileUploadArea.classList.add('drag-over');
    });

    fileUploadArea.addEventListener('dragleave', function () {
        fileUploadArea.classList.remove('drag-over');
    });

    fileUploadArea.addEventListener('drop', function (e) {
        e.preventDefault();
        fileUploadArea.classList.remove('drag-over');
        var file = e.dataTransfer.files[0];
        if (file) readFile(file);
    });

    processBtn.addEventListener('click', processData);
    downloadBtn.addEventListener('click', downloadProcessed);
    healthBtn.addEventListener('click', copyForHealth);
    shortcutBtn.addEventListener('click', function (e) {
        e.preventDefault();
        runShortcut();
    });

    // ==============================
    // File Reading
    // ==============================
    function readFile(file) {
        var reader = new FileReader();
        reader.onload = function (e) {
            try {
                parseCSV(e.target.result);
            } catch (err) {
                showFileError('שגיאה בקריאת הקובץ: ' + err.message);
            }
        };
        reader.onerror = function () {
            showFileError('לא ניתן לקרוא את הקובץ');
        };
        reader.readAsText(file, 'UTF-8');
    }

    // ==============================
    // CSV Parsing
    // ==============================
    function detectDelimiter(text) {
        var lines = text.split('\n').slice(0, 15);
        var delimiters = [',', ';', '\t'];
        var best = ',';
        var maxScore = 0;

        for (var i = 0; i < delimiters.length; i++) {
            var d = delimiters[i];
            var score = 0;
            for (var j = 0; j < lines.length; j++) {
                score += lines[j].split(d).length - 1;
            }
            if (score > maxScore) {
                maxScore = score;
                best = d;
            }
        }
        return best;
    }

    function parseCSVLine(line, delim) {
        var fields = [];
        var current = '';
        var inQuotes = false;

        for (var i = 0; i < line.length; i++) {
            var ch = line[i];
            if (ch === '"') {
                if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === delim && !inQuotes) {
                fields.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        fields.push(current.trim());
        return fields;
    }

    function parseCSV(text) {
        // Remove BOM
        if (text.charCodeAt(0) === 0xFEFF) {
            text = text.substring(1);
        }

        delimiter = detectDelimiter(text);
        var lines = text.split(/\r?\n/);

        // Find header row — look for a line containing glucose-related keywords
        // Hebrew LibreView exports use 'סוכר' (sugar) instead of 'גלוקוז' (glucose)
        var headerIndex = -1;
        for (var i = 0; i < Math.min(lines.length, 20); i++) {
            var lower = lines[i].toLowerCase();
            var hasGlucose = lower.includes('glucose') || lower.includes('גלוקוז') || lower.includes('סוכר');
            var hasDevice = lower.includes('device') || lower.includes('timestamp') ||
                lower.includes('serial') || lower.includes('מכשיר') || lower.includes('חותמת זמן');
            if (hasGlucose && hasDevice) {
                headerIndex = i;
                break;
            }
        }

        // Fallback: look for a line with many delimiters (likely the header)
        if (headerIndex === -1) {
            var maxCols = 0;
            for (var i = 0; i < Math.min(lines.length, 20); i++) {
                var cols = lines[i].split(delimiter).length;
                if (cols > maxCols) {
                    maxCols = cols;
                    headerIndex = i;
                }
            }
        }

        if (headerIndex === -1) {
            showFileError('לא נמצאה שורת כותרת בקובץ');
            return;
        }

        metadataLines = lines.slice(0, headerIndex);
        headerRow = parseCSVLine(lines[headerIndex], delimiter);

        // Detect column indices from header names
        detectColumns(headerRow);

        // Parse data rows
        rawRows = [];
        for (var i = headerIndex + 1; i < lines.length; i++) {
            if (lines[i].trim() === '') continue;
            var fields = parseCSVLine(lines[i], delimiter);
            if (fields.length >= 3) {
                rawRows.push(fields);
            }
        }

        if (rawRows.length === 0) {
            showFileError('לא נמצאו שורות נתונים בקובץ');
            return;
        }

        // Show success info
        showFileSuccess(rawRows.length, headerRow.length);
        formatSelect.classList.remove('hidden');

        // Detect date range in data and set defaults
        setDefaultDateRange();

        // Show step 3
        step3.classList.remove('hidden');
        step3.scrollIntoView({ behavior: 'smooth' });
    }

    function detectColumns(headers) {
        for (var i = 0; i < headers.length; i++) {
            var h = headers[i];

            // Timestamp column: "חותמת זמן מכשיר" or "Device Timestamp"
            if (h.includes('חותמת זמן') || h.toLowerCase().includes('timestamp')) {
                colTimestamp = i;
            }
            // Historic glucose: "רמות סוכר היסטוריות" or "Historic Glucose"
            if (h.includes('היסטורי') || h.toLowerCase().includes('historic glucose')) {
                colHistoric = i;
            }
            // Scan glucose: "רמת סוכר מסריקה" or "Scan Glucose"
            if (h.includes('סריקה') || h.includes('מסריקה') || h.toLowerCase().includes('scan glucose')) {
                colScan = i;
            }
        }
    }

    // ==============================
    // Date Parsing
    // ==============================
    function parseDate(dateStr) {
        if (!dateStr || dateStr.trim() === '') return null;
        dateStr = dateStr.trim();

        var format = dateFormatSel.value;
        var match, day, month, year, hour, min;

        // Pattern: two-part date + time
        match = dateStr.match(/(\d{1,4})[-\/.](\d{1,2})[-\/.](\d{1,4})\s+(\d{1,2}):(\d{2})/);
        if (match) {
            var a = parseInt(match[1], 10);
            var b = parseInt(match[2], 10);
            var c = parseInt(match[3], 10);
            hour = parseInt(match[4], 10);
            min = parseInt(match[5], 10);

            if (format === 'yyyy-mm-dd' || (format === 'auto' && a > 31)) {
                year = a; month = b - 1; day = c;
            } else if (format === 'mm-dd-yyyy') {
                month = a - 1; day = b; year = c;
            } else if (format === 'dd-mm-yyyy') {
                day = a; month = b - 1; year = c;
            } else {
                // Auto-detect
                if (a > 31) {
                    year = a; month = b - 1; day = c;
                } else if (c > 31) {
                    // a and b are day/month
                    if (a > 12) {
                        day = a; month = b - 1; year = c;
                    } else if (b > 12) {
                        month = a - 1; day = b; year = c;
                    } else {
                        // Ambiguous — default DD-MM-YYYY (Israeli convention)
                        day = a; month = b - 1; year = c;
                    }
                } else {
                    day = a; month = b - 1; year = c;
                }
            }

            // Handle 2-digit years
            if (year < 100) year += 2000;

            return new Date(year, month, day, hour, min);
        }

        // Pattern: date only (no time)
        match = dateStr.match(/(\d{1,4})[-\/.](\d{1,2})[-\/.](\d{1,4})/);
        if (match) {
            var a = parseInt(match[1], 10);
            var b = parseInt(match[2], 10);
            var c = parseInt(match[3], 10);

            if (format === 'yyyy-mm-dd' || (format === 'auto' && a > 31)) {
                year = a; month = b - 1; day = c;
            } else if (format === 'mm-dd-yyyy') {
                month = a - 1; day = b; year = c;
            } else if (format === 'dd-mm-yyyy') {
                day = a; month = b - 1; year = c;
            } else {
                if (a > 31) { year = a; month = b - 1; day = c; }
                else if (c > 31) {
                    if (a > 12) { day = a; month = b - 1; year = c; }
                    else if (b > 12) { month = a - 1; day = b; year = c; }
                    else { day = a; month = b - 1; year = c; }
                } else { day = a; month = b - 1; year = c; }
            }

            if (year < 100) year += 2000;
            return new Date(year, month, day);
        }

        // Last resort: native parser
        var d = new Date(dateStr);
        return isNaN(d.getTime()) ? null : d;
    }

    function formatDateForInput(date) {
        var y = date.getFullYear();
        var m = String(date.getMonth() + 1).padStart(2, '0');
        var d = String(date.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + d;
    }

    function formatDateDisplay(date) {
        var d = String(date.getDate()).padStart(2, '0');
        var m = String(date.getMonth() + 1).padStart(2, '0');
        var y = date.getFullYear();
        var h = String(date.getHours()).padStart(2, '0');
        var min = String(date.getMinutes()).padStart(2, '0');
        return d + '/' + m + '/' + y + ' ' + h + ':' + min;
    }

    function setDefaultDateRange() {
        var dates = [];
        for (var i = 0; i < rawRows.length; i++) {
            var d = parseDate(rawRows[i][colTimestamp]);
            if (d) dates.push(d);
        }

        if (dates.length > 0) {
            dates.sort(function (a, b) { return a - b; });
            dateFrom.value = formatDateForInput(dates[0]);
            dateTo.value = formatDateForInput(dates[dates.length - 1]);
        }
    }

    // ==============================
    // Data Processing
    // ==============================
    function processData() {
        if (rawRows.length === 0) return;

        var fromVal = dateFrom.value;
        var toVal = dateTo.value;

        if (!fromVal || !toVal) {
            showToast('נא לבחור טווח תאריכים');
            return;
        }

        var fromDate = new Date(fromVal);
        fromDate.setHours(0, 0, 0, 0);
        var toDate = new Date(toVal);
        toDate.setHours(23, 59, 59, 999);

        if (fromDate > toDate) {
            showToast('תאריך ההתחלה חייב להיות לפני תאריך הסיום');
            return;
        }

        // Filter by date range
        var filtered = [];
        for (var i = 0; i < rawRows.length; i++) {
            var row = rawRows[i];
            var date = parseDate(row[colTimestamp]);
            if (!date) continue;
            if (date >= fromDate && date <= toDate) {
                filtered.push(row);
            }
        }

        if (filtered.length === 0) {
            showToast('לא נמצאו נתונים בטווח התאריכים שנבחר');
            return;
        }

        // Apply column logic: if col5 (Historic) empty and col6 (Scan) has data,
        // copy col6 to col5
        for (var i = 0; i < filtered.length; i++) {
            var row = filtered[i].slice(); // clone
            var historic = row[colHistoric] ? row[colHistoric].trim() : '';
            var scan = row[colScan] ? row[colScan].trim() : '';

            if (historic === '' && scan !== '') {
                row[colHistoric] = scan;
            }
            filtered[i] = row;
        }

        // Keep only rows that have a glucose value in colHistoric after the merge
        var withGlucose = [];
        for (var i = 0; i < filtered.length; i++) {
            var val = filtered[i][colHistoric] ? filtered[i][colHistoric].trim() : '';
            if (val !== '') {
                withGlucose.push(filtered[i]);
            }
        }

        // Sort by date, earliest first
        withGlucose.sort(function (a, b) {
            var dA = parseDate(a[colTimestamp]);
            var dB = parseDate(b[colTimestamp]);
            if (!dA) return 1;
            if (!dB) return -1;
            return dA - dB;
        });

        processedRows = withGlucose;

        // Display results
        displayStats(withGlucose);
        displayPreview(withGlucose);

        step4.classList.remove('hidden');
        step4.scrollIntoView({ behavior: 'smooth' });
    }

    function displayStats(rows) {
        var values = [];
        for (var i = 0; i < rows.length; i++) {
            var v = parseFloat(rows[i][colHistoric]);
            if (!isNaN(v)) values.push(v);
        }

        var avg = values.length > 0
            ? (values.reduce(function (a, b) { return a + b; }, 0) / values.length).toFixed(1)
            : '—';
        var min = values.length > 0 ? Math.min.apply(null, values) : '—';
        var max = values.length > 0 ? Math.max.apply(null, values) : '—';

        // Estimated A1C: (average glucose + 46.7) / 28.7
        var a1c = values.length > 0
            ? ((parseFloat(avg) + 46.7) / 28.7).toFixed(1)
            : '—';

        statsEl.innerHTML =
            '<div class="stat">' +
            '  <span class="stat-value">' + rows.length + '</span>' +
            '  <span class="stat-label">קריאות</span>' +
            '</div>' +
            '<div class="stat">' +
            '  <span class="stat-value">' + avg + '</span>' +
            '  <span class="stat-label">ממוצע</span>' +
            '</div>' +
            '<div class="stat">' +
            '  <span class="stat-value">' + min + '</span>' +
            '  <span class="stat-label">מינימום</span>' +
            '</div>' +
            '<div class="stat">' +
            '  <span class="stat-value">' + max + '</span>' +
            '  <span class="stat-label">מקסימום</span>' +
            '</div>';
    }

    function displayPreview(rows) {
        var maxPreview = 30;
        var html = '<table><thead><tr>' +
            '<th>#</th>' +
            '<th>תאריך ושעה</th>' +
            '<th>סוכר (mg/dL)</th>' +
            '</tr></thead><tbody>';

        var count = Math.min(rows.length, maxPreview);
        for (var i = 0; i < count; i++) {
            var date = parseDate(rows[i][colTimestamp]);
            var dateStr = date ? formatDateDisplay(date) : rows[i][colTimestamp];
            var glucose = rows[i][colHistoric] || '';
            var gVal = parseFloat(glucose);
            var colorClass = '';
            if (!isNaN(gVal)) {
                if (gVal < 70) colorClass = 'glucose-low';
                else if (gVal <= 180) colorClass = 'glucose-normal';
                else colorClass = 'glucose-high';
            }

            html += '<tr>' +
                '<td>' + (i + 1) + '</td>' +
                '<td>' + escapeHtml(dateStr) + '</td>' +
                '<td class="' + colorClass + '">' + escapeHtml(glucose) + '</td>' +
                '</tr>';
        }

        if (rows.length > maxPreview) {
            html += '<tr><td colspan="3" class="more">... ועוד ' +
                (rows.length - maxPreview) + ' שורות</td></tr>';
        }

        html += '</tbody></table>';
        previewEl.innerHTML = html;
    }

    // ==============================
    // Download
    // ==============================
    function downloadProcessed() {
        if (processedRows.length === 0) return;

        var csvContent = headerRow.join(delimiter) + '\n';
        for (var i = 0; i < processedRows.length; i++) {
            var row = processedRows[i];
            var fields = [];
            for (var j = 0; j < row.length; j++) {
                var field = row[j] || '';
                if (field.indexOf(delimiter) !== -1 || field.indexOf('"') !== -1 || field.indexOf('\n') !== -1) {
                    field = '"' + field.replace(/"/g, '""') + '"';
                }
                fields.push(field);
            }
            csvContent += fields.join(delimiter) + '\n';
        }

        var blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'glucose_data_filtered.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast('הקובץ הורד בהצלחה');
    }

    // ==============================
    // Apple Health Integration
    // ==============================
    function copyForHealth() {
        if (processedRows.length === 0) return;

        // Build a simple CSV: ISO date, glucose value (one per line)
        var lines = [];
        for (var i = 0; i < processedRows.length; i++) {
            var date = parseDate(processedRows[i][colTimestamp]);
            var glucose = processedRows[i][colHistoric] ? processedRows[i][colHistoric].trim() : '';
            if (date && glucose !== '') {
                lines.push(date.toISOString() + ',' + glucose);
            }
        }

        var clipboardText = lines.join('\n');

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(clipboardText).then(function () {
                onHealthCopied(lines.length);
            }).catch(function () {
                fallbackCopy(clipboardText, lines.length);
            });
        } else {
            fallbackCopy(clipboardText, lines.length);
        }
    }

    function fallbackCopy(text, count) {
        var textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();

        try {
            document.execCommand('copy');
            onHealthCopied(count);
        } catch (e) {
            showToast('לא ניתן להעתיק. נסו שוב.');
        }

        document.body.removeChild(textarea);
    }

    function onHealthCopied(count) {
        healthBtn.innerHTML =
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
            '<polyline points="20 6 9 17 4 12"/>' +
            '</svg>' +
            count + ' קריאות הועתקו ללוח';

        step5.classList.remove('hidden');
        step5.scrollIntoView({ behavior: 'smooth' });

        setTimeout(function () {
            healthBtn.innerHTML =
                '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>' +
                '</svg>' +
                'העברה לאפליקציית הבריאות';
        }, 3000);
    }

    function runShortcut() {
        var name = encodeURIComponent('ייבוא סוכר לבריאות');
        window.location.href = 'shortcuts://run-shortcut?name=' + name + '&input=clipboard';
    }

    // ==============================
    // UI Helpers
    // ==============================
    function showFileSuccess(rowCount, colCount) {
        fileInfo.classList.remove('hidden', 'error');
        fileInfo.innerHTML =
            '<p>נקראו ' + rowCount + ' שורות נתונים</p>' +
            '<p>' + colCount + ' עמודות זוהו</p>';
    }

    function showFileError(msg) {
        fileInfo.classList.remove('hidden');
        fileInfo.classList.add('error');
        fileInfo.innerHTML = '<p>' + escapeHtml(msg) + '</p>';
    }

    function showToast(msg) {
        var existing = document.querySelector('.toast');
        if (existing) existing.remove();

        var toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = msg;
        document.body.appendChild(toast);

        requestAnimationFrame(function () {
            toast.classList.add('show');
        });

        setTimeout(function () {
            toast.classList.remove('show');
            setTimeout(function () { toast.remove(); }, 300);
        }, 2500);
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

})();
