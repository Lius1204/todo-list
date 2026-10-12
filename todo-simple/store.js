// store.js
// "Kho dữ liệu" của dự án: đọc/ghi file CSV và nạp danh sách 1 triệu email seed vào RAM.
//
// File này gồm 4 nhóm việc:
//   1) parseCsv / escapeField      : tự xử lý dấu phẩy, dấu ngoặc kép (thay 2 thư viện của bản cũ)
//   2) readCsv / writeCsv          : đọc file CSV thành mảng object, ghi mảng object xuống file
//   3) loadSeedEmails / isSeeded   : nạp 1 triệu email lên RAM (Set) và tra cứu siêu nhanh
//   4) makeId                      : sinh id ngẫu nhiên dùng chung cho user và task
//
// Tự kiểm tra file này: node store.js

const fs = require('fs');       // module làm việc với file (có sẵn của Node)
const path = require('path');   // module ghép đường dẫn (có sẵn của Node)
const crypto = require('crypto'); // module sinh số ngẫu nhiên an toàn (có sẵn của Node)

// ---------- Đường dẫn các file dữ liệu ----------
const DATA_DIR = path.join(__dirname, 'data');            // thư mục data nằm cạnh file này
const USERS_FILE = path.join(DATA_DIR, 'users.csv');      // danh sách tài khoản thật
const TASKS_FILE = path.join(DATA_DIR, 'tasks.csv');      // danh sách công việc
const SEED_FILE = path.join(DATA_DIR, 'seed_users.csv');  // 1 triệu email ảo (do seed.js sinh)

// ---------- Tên các cột của 2 file CSV ----------
// Thứ tự trong mảng này CHÍNH LÀ thứ tự cột trong file. Mọi hàm đều dùng chung mảng này.
// verifyToken: token trong link xác thực email, rỗng nghĩa là chưa có (hoặc đã dùng rồi).
const USERS_HEADER = ['id', 'email', 'salt', 'passwordHash', 'status', 'verifyToken', 'createdAt'];

// assignedTo: id của user được gán việc, rỗng nghĩa là chưa gán cho ai.
const TASKS_HEADER = ['id', 'content', 'createdBy', 'assignedTo', 'completed', 'createdAt'];

// ===========================================================================
// NHÓM 1: Chuyển đổi qua lại giữa chuỗi CSV và mảng object
// ===========================================================================

// Cắt một chuỗi CSV thành mảng các dòng, mỗi dòng là mảng các ô.
// Ví dụ: 'id,content\nt1,"a, b"'  ->  [['id','content'], ['t1','a, b']]
// Cách làm: đọc từng ký tự, dùng biến inQuotes như một cái công tắc.
function parseCsv(text) {
    const rows = [];    // kết quả cuối cùng: mảng các dòng
    let row = [];       // dòng đang đọc dở
    let field = '';     // ô đang đọc dở
    let inQuotes = false; // true = đang ở bên trong một ô được bọc bởi dấu "

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (inQuotes) {
            // Đang trong ô bọc ngoặc kép: mọi thứ đều là nội dung, kể cả dấu phẩy và xuống dòng
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; } // "" đại diện cho 1 dấu " thật
                else inQuotes = false;                          // dấu " này là kết thúc ô bọc
            } else {
                field += ch;
            }
            continue; // đã xử lý xong ký tự này, sang ký tự tiếp theo
        }

        // Không ở trong ngoặc kép
        if (ch === '"') { inQuotes = true; continue; }        // bắt đầu một ô bọc ngoặc kép
        if (ch === ',') { row.push(field); field = ''; continue; }  // hết 1 ô
        if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; } // hết 1 dòng
        if (ch === '\r') continue;                            // bỏ qua ký tự \r của file Windows
        field += ch;                                          // ký tự bình thường
    }

    // Dòng cuối cùng: chỉ thêm nếu file không kết thúc bằng dấu xuống dòng
    if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

    return rows;
}

// Bọc một giá trị trong dấu " nếu nó chứa dấu phẩy, dấu " hoặc dấu xuống dòng.
// Quy tắc CSV: dấu " bên trong được viết đôi lên ("").
function escapeField(value) {
    const text = String(value === undefined || value === null ? '' : value); // luôn làm việc với chuỗi
    if (text.includes(',') || text.includes('"') || text.includes('\n') || text.includes('\r')) {
        return '"' + text.replace(/"/g, '""') + '"'; // bọc và nhân đôi dấu "
    }
    return text; // không có ký tự đặc biệt thì để nguyên
}

// ===========================================================================
// NHÓM 2: Đọc / ghi file CSV
// ===========================================================================

// Ghi mảng rows xuống file CSV (đè toàn bộ file cũ).
function writeCsv(filePath, header, rows) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true }); // bảo đảm thư mục chứa file tồn tại

    const lines = [header.join(',')]; // dòng đầu tiên luôn là tên các cột
    for (const row of rows) {
        lines.push(header.map(function (name) { return escapeField(row[name]); }).join(','));
    }
    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8'); // ghi cả file trong 1 lần
}

// Tạo file mới (chỉ có dòng header) nếu file chưa tồn tại.
function ensureFile(filePath, header) {
    if (fs.existsSync(filePath)) return; // đã có file thì không làm gì
    writeCsv(filePath, header, []);      // chưa có thì tạo file rỗng có header
}

// Đọc file CSV thành mảng object. Ví dụ: [{ id: 'user_abc', email: 'a@b.com', ... }, ...]
// Nếu file chưa tồn tại thì tự tạo file có header rồi trả về mảng rỗng.
function readCsv(filePath, header) {
    ensureFile(filePath, header);                              // bảo đảm file tồn tại
    const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));  // đọc cả file thành mảng các dòng
    if (rows.length === 0) return [];                          // file hoàn toàn rỗng

    // Kiểm tra dòng header đúng như mình mong đợi, tránh đọc nhầm dữ liệu lạ
    const headerOk = rows[0].length === header.length && header.every(function (name, i) { return rows[0][i] === name; });
    if (!headerOk) {
        throw new Error(path.basename(filePath) + ' co header sai. Dang co: ' + rows[0].join(','));
    }

    const result = [];
    for (const row of rows.slice(1)) { // bỏ dòng header
        if (row.length === 1 && row[0] === '') continue; // bỏ dòng trống
        if (row.length !== header.length) {
            throw new Error(path.basename(filePath) + ' co dong sai so cot (' + row.length + ' thay vi ' + header.length + ')');
        }
        const obj = {}; // gắn từng ô vào tên cột tương ứng
        header.forEach(function (name, index) { obj[name] = row[index]; });
        result.push(obj);
    }
    return result;
}

// ===========================================================================
// NHÓM 3: Danh sách 1 triệu email seed (nạp lên RAM đúng 1 lần)
// ===========================================================================

let seedEmails = null; // null = chưa nạp; sau lần nạp đầu tiên sẽ là một Set các email

// Nạp file seed_users.csv vào Set trong RAM rồi giữ lại để dùng cho mọi lần tra cứu sau.
function loadSeedEmails() {
    if (seedEmails) return seedEmails; // đã nạp rồi thì trả lại luôn, không đọc file lại

    seedEmails = new Set(); // Set giúp tra cứu cực nhanh (không phải duyệt cả triệu dòng)
    if (!fs.existsSync(SEED_FILE)) {
        console.warn('[store] Chua co data/seed_users.csv - hay chay: npm run seed');
        return seedEmails; // chưa có file thì coi như danh sách rỗng, server vẫn chạy
    }

    const text = fs.readFileSync(SEED_FILE, 'utf8');
    const lines = text.split('\n');
    for (let i = 1; i < lines.length; i++) { // bắt đầu từ 1 để bỏ dòng header
        const line = lines[i].trim();
        if (line === '') continue;
        // File này do seed.js tự sinh nên không bao giờ có dấu phẩy hay ngoặc kép trong dữ liệu,
        // vì vậy tách bằng dấu phẩy là an toàn (khác với users.csv/tasks.csv phải dùng parseCsv).
        const parts = line.split(',');
        seedEmails.add(parts[parts.length - 1].toLowerCase()); // cột cuối cùng là email
    }
    return seedEmails;
}

// Kiểm tra 1 email có nằm trong danh sách 1 triệu email ảo hay không.
function isSeeded(email) {
    loadSeedEmails(); // lần đầu sẽ nạp, các lần sau dùng lại dữ liệu đã có trên RAM
    return seedEmails.has(String(email || '').trim().toLowerCase()); // chuẩn hoá rồi tra
}

// ===========================================================================
// NHÓM 4: Sinh id ngẫu nhiên
// ===========================================================================

// Sinh id dạng "user_3f9a1c2b7d4e" hoặc "task_8d7e6f5a0b1c".
// Dùng số ngẫu nhiên nên id không phụ thuộc vào số dòng trong file.
function makeId(prefix) {
    return prefix + '_' + crypto.randomBytes(6).toString('hex'); // 12 ký tự hex, gần như không thể trùng
}

// ===========================================================================
// Xuất ra cho các file khác dùng
// ===========================================================================
module.exports = {
    USERS_FILE: USERS_FILE,
    TASKS_FILE: TASKS_FILE,
    SEED_FILE: SEED_FILE,
    USERS_HEADER: USERS_HEADER,
    TASKS_HEADER: TASKS_HEADER,
    readCsv: readCsv,
    writeCsv: writeCsv,
    loadSeedEmails: loadSeedEmails,
    isSeeded: isSeeded,
    makeId: makeId,
};

// ===========================================================================
// Tự kiểm tra: chỉ chạy khi bạn gõ "node store.js" (không chạy khi file khác require nó)
// ===========================================================================
if (require.main === module) {
    console.log('=== Tu kiem tra store.js ===');

    // 1) Ghi rồi đọc lại: kiểm tra dấu phẩy, dấu ngoặc kép và tiếng Việt không bị phá
    const testFile = path.join(DATA_DIR, 'store_test.csv');
    const testHeader = ['id', 'content'];
    writeCsv(testFile, testHeader, [
        { id: 't1', content: 'Co dau, phay' },
        { id: 't2', content: 'Co "ngoac kep"' },
        { id: 't3', content: 'Tieng Viet: luyen tap Node.js' },
    ]);
    const readBack = readCsv(testFile, testHeader);
    console.log('1) Ghi roi doc lai:', JSON.stringify(readBack));
    fs.unlinkSync(testFile); // xoá file test cho sạch

    // 2) Đọc 2 file dữ liệu thật (tự tạo nếu chưa có, kèm header đúng)
    console.log('2) users.csv co', readCsv(USERS_FILE, USERS_HEADER).length, 'dong du lieu');
    console.log('3) tasks.csv co', readCsv(TASKS_FILE, TASKS_HEADER).length, 'dong du lieu');

    // 4) Nạp 1 triệu email và đo thời gian
    const startedAt = Date.now();
    const emails = loadSeedEmails();
    console.log('4) Da nap ' + emails.size.toLocaleString('en-US') + ' email seed trong ' + (Date.now() - startedAt) + ' ms');

    // 5) Tra cứu thử
    console.log('5) isSeeded(seeduser0004242@example.com) =', isSeeded('seeduser0004242@example.com'));
    console.log('   isSeeded(SEEDUSER0000001@EXAMPLE.COM) =', isSeeded('SEEDUSER0000001@EXAMPLE.COM'));
    console.log('   isSeeded(khong.co@example.com)        =', isSeeded('khong.co@example.com'));
    console.log('   isSeeded(seeduser000004242@example.com) =', isSeeded('seeduser000004242@example.com'), '<- 9 chu so nen KHONG co trong seed');

    // 6) Đo tốc độ: 100.000 lần tra cứu hết bao nhiêu ms
    const lookupStart = Date.now();
    let found = 0;
    for (let i = 0; i < 100000; i++) {
        if (isSeeded('seeduser0004242@example.com')) found++;
    }
    console.log('6) 100.000 lan tra cuu het ' + (Date.now() - lookupStart) + ' ms (tim thay ' + found + ' lan)');
}