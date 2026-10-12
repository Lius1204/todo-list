// auth.js
// Xu ly tai khoan: dang ky (buoc 1), xac thuc email (buoc 3), dang nhap, dang xuat.
//
// Ba y tuong chinh can nho:
//   1) Mat khau KHONG luu thang: luu salt (muoi) + passwordHash (bam bang scryptSync).
//   2) Tai khoan moi luu voi status = 'pending'. Cot status trong CSV chi co 2 gia tri:
//      'pending' (cho xac thuc) va 'active' (da kich hoat). Chi 'active' moi dang nhap duoc.
//   3) Sau khi luu tai khoan thi GUI EMAIL CHAY NEN (khong await) -> tra ket qua ngay,
//      nho vay thoi gian dang ky khong bao gom 3-5 giay gui mail.
//
// Tu kiem tra file nay: npm run auth:test

const crypto = require('crypto'); // bam mat khau + sinh token ngau nhien (co san cua Node)
const mail = require('./mail');   // gui email xac thuc (file minh vua viet)

// Lay cac thu can dung tu "kho du lieu" store.js
const {
    USERS_FILE,     // duong dan data/users.csv
    USERS_HEADER,   // ten cac cot cua file nguoi dung
    readCsv,        // doc file CSV thanh mang object
    writeCsv,       // ghi mang object xuong file CSV
    isSeeded,       // kiem tra email co nam trong 1 trieu email ao khong
    makeId,         // sinh id ngau nhien
} = require('./store');

// ============================================================================
// PHAN 1: Hang so va cac ham phu tro
// ============================================================================

const PASSWORD_MIN = 8;   // mat khau toi thieu 8 ky tu (theo de bai)
const PASSWORD_MAX = 20;  // mat khau toi da 20 ky tu
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;                        // co @, co ten mien, khong khoang trang
const UPPERCASE = /[A-Z]/;                                                  // co it nhat 1 chu HOA
const LOWERCASE = /[a-z]/;                                                  // co it nhat 1 chu thuong
const SPECIAL = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>\/?`~]/;                   // co it nhat 1 ky tu dac biet

// Phien dang nhap luu trong RAM: Map<token, userId>.
// Restart server la mat het -> phai dang nhap lai. Doi lai, logout xoa duoc that.
const sessions = new Map();

// Tao loi kem ma HTTP (400/401/403/409...). server.js se doc error.status de tra ve dung ma.
function httpError(status, message) {
    const error = new Error(message); // tao loi nhu binh thuong
    error.status = status;            // gan them ma HTTP vao loi
    return error;                     // tra ve de dung voi tu khoa "throw"
}

// Chuan hoa email: bo khoang trang 2 dau va dua ve chu thuong.
// Nho vay "A@B.COM " va "a@b.com" duoc coi la CUNG mot email.
function normalizeEmail(email) {
    return String(email === undefined || email === null ? '' : email).trim().toLowerCase();
}

// Kiem tra email ngay nhap vao; nem loi 400 neu sai; tra ve email da chuan hoa neu dung.
function checkEmail(email) {
    const cleanEmail = normalizeEmail(email);
    if (cleanEmail === '') throw httpError(400, 'Thieu email');
    if (!EMAIL_PATTERN.test(cleanEmail)) throw httpError(400, 'Email khong dung dinh dang');
    return cleanEmail;
}

// Kiem tra mat khau theo 4 quy tac cua de bai; nem loi 400 voi THONG BAO CU THE
// (thieu chu hoa? thieu ky tu dac biet? ...) de nguoi dung biet duong sua.
function checkPassword(password) {
    const text = typeof password === 'string' ? password : '';
    if (text === '') throw httpError(400, 'Thieu mat khau');
    if (text.length < PASSWORD_MIN) throw httpError(400, 'Mat khau phai co it nhat ' + PASSWORD_MIN + ' ky tu');
    if (text.length > PASSWORD_MAX) throw httpError(400, 'Mat khau khong duoc dai qua ' + PASSWORD_MAX + ' ky tu');
    if (!UPPERCASE.test(text)) throw httpError(400, 'Mat khau phai co it nhat 1 chu HOA');
    if (!LOWERCASE.test(text)) throw httpError(400, 'Mat khau phai co it nhat 1 chu thuong');
    if (!SPECIAL.test(text)) throw httpError(400, 'Mat khau phai co it nhat 1 ky tu dac biet');
    return text;
}

// Chi lay 3 truong an toan de tra ra ngoai. TUYET DOI khong tra salt/passwordHash/verifyToken.
function publicUser(user) {
    return { id: user.id, email: user.email, status: user.status };
}

// Doc toan bo file nguoi dung (dung lai o nhieu ham ben duoi)
function readUsers() {
    return readCsv(USERS_FILE, USERS_HEADER);
}

// Ham BAM MAT KHAU - trai tim cua phan bao mat.
// scryptSync(password, salt, 64): bam mat khau voi muoi rieng, lay ra 64 byte -> doi sang chuoi hex (128 ky tu).
function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
}

// ============================================================================
// PHAN 2: BUOC 1 - Dang ky tai khoan (luu o trang thai cho xac thuc)
// ============================================================================

function signup(email, password) {
    const cleanEmail = checkEmail(email);       // sai dinh dang -> nem loi 400
    const cleanPassword = checkPassword(password); // sai quy tac -> nem loi 400

    // 1) Chan trung voi 1 trieu email ao: tra bang Set tren RAM, rat nhanh
    if (isSeeded(cleanEmail)) {
        throw httpError(409, 'Email nay da duoc dang ky, hay thu dang nhap');
    }

    // 2) Chan trung voi tai khoan that da co trong users.csv
    const users = readUsers();
    const existed = users.find(function (user) { return user.email === cleanEmail; });
    if (existed) {
        throw httpError(409, 'Email nay da duoc dang ky, hay thu dang nhap');
    }

    // 3) Bam mat khau: moi tai khoan co 1 "muoi" (salt) ngau nhien rieng
    const salt = crypto.randomBytes(16).toString('hex');              // 32 ky tu hex
    const passwordHash = hashPassword(cleanPassword, salt);            // 128 ky tu hex

    // 4) Sinh token xac thuc ngau nhien (48 ky tu hex) va tao ban ghi tai khoan
    const verifyToken = crypto.randomBytes(24).toString('hex');
    const newUser = {
        id: makeId('user'),                 // vi du: user_3f9a1c2b7d4e
        email: cleanEmail,
        salt: salt,
        passwordHash: passwordHash,
        status: 'pending',                  // BUOC 1: cho xac thuc, chua duoc dang nhap
        verifyToken: verifyToken,           // token nguoi dung se nhan qua email
        createdAt: new Date().toISOString(),
    };

    users.push(newUser);                            // them vao cuoi danh sach
    writeCsv(USERS_FILE, USERS_HEADER, users);      // GHI XUONG FILE truoc khi tra ket qua

    // 5) BUOC 2: gui email xac thuc - co tinh KHONG await de khong lam cham phan hoi.
    //    .catch() de neu gui loi thi chi ghi log, khong lam sap server.
    mail.sendVerifyEmail(cleanEmail, verifyToken).catch(function (error) {
        console.error('[auth] Gui email xac thuc that bai cho ' + cleanEmail + ': ' + error.message);
        console.error('[auth] Tai khoan van o trang thai pending, nguoi dung chua the dang nhap.');
    });

    return publicUser(newUser); // tra ve thong tin an toan ngay lap tuc
}

// ============================================================================
// PHAN 3: BUOC 3 - Nguoi dung bam link trong email -> kich hoat tai khoan
// ============================================================================

function verifyEmail(token) {
    const cleanToken = String(token === undefined || token === null ? '' : token).trim();
    if (cleanToken === '') throw httpError(400, 'Thieu token xac thuc');

    const users = readUsers();
    // Tim tai khoan co verifyToken dung bang token nguoi dung vua bam
    const user = users.find(function (item) {
        return item.verifyToken !== '' && item.verifyToken === cleanToken;
    });
    if (!user) throw httpError(400, 'Link xac thuc khong hop le hoac da duoc dung truoc do');
    if (user.status === 'active') throw httpError(400, 'Tai khoan nay da duoc xac thuc truoc do');

    user.status = 'active';   // BUOC 3: chuyen sang da kich hoat -> duoc phep dang nhap
    user.verifyToken = '';    // xoa token di -> link nay khong the dung lai lan hai
    writeCsv(USERS_FILE, USERS_HEADER, users);

    return { email: user.email };
}

// ============================================================================
// PHAN 4: Dang nhap / dang xuat / lay thong tin nguoi dang nhap
// ============================================================================

function login(email, password) {
    const cleanEmail = normalizeEmail(email);
    if (cleanEmail === '') throw httpError(400, 'Thieu email');
    if (typeof password !== 'string' || password === '') throw httpError(400, 'Thieu mat khau');

    const users = readUsers();
    const user = users.find(function (item) { return item.email === cleanEmail; });

    // Khong tim thay tai khoan: VAN tra CUNG mot thong bao nhu khi sai mat khau.
    // Muc dich: nguoi ngoai khong biet duoc email nao co ton tai trong he thong.
    if (!user) throw httpError(401, 'Email hoac mat khau khong dung');

    // Bam lai mat khau nguoi dung vua nhap bang DUNG salt cua tai khoan do, roi so sanh
    const inputHash = hashPassword(password, user.salt);
    if (inputHash !== user.passwordHash) throw httpError(401, 'Email hoac mat khau khong dung');

    // Mat khau dung nhung tai khoan chua kich hoạt -> bao ro de nguoi dung biet duong xu ly
    if (user.status !== 'active') {
        throw httpError(403, 'Tai khoan chua duoc xac thuc. Hay mo email va bam link xac thuc truoc');
    }

    // Tao phien dang nhap: token ngau nhien luu trong RAM
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, user.id);

    return { token: token, user: publicUser(user) };
}

// Dang xuat: xoa token khoi RAM. Goi lai nhieu lan cung khong loi (xoa khong co thi thoi).
function logout(token) {
    sessions.delete(String(token === undefined || token === null ? '' : token));
    return true;
}

// Cho biet AI dang goi API, dua vao token gui len. Nem loi 401 neu token sai/het hieu luc.
function getUserByToken(token) {
    const cleanToken = String(token === undefined || token === null ? '' : token).trim();
    if (cleanToken === '' || !sessions.has(cleanToken)) {
        throw httpError(401, 'Phien dang nhap khong hop le, hay dang nhap lai');
    }

    const userId = sessions.get(cleanToken);
    const user = readUsers().find(function (item) { return item.id === userId; });
    if (!user || user.status !== 'active') {
        sessions.delete(cleanToken); // tai khoan bi xoa hoac khong con active -> huy phien luon
        throw httpError(401, 'Phien dang nhap khong hop le, hay dang nhap lai');
    }
    return publicUser(user);
}

// Danh sach nguoi dung DA KICH HOAT, dung de do vao o chon "Assign" tren trang task.
function listActiveUsers() {
    return readUsers()
        .filter(function (user) { return user.status === 'active'; })
        .map(publicUser); // chi tra id, email, status - khong lo salt/hash
}

// Tim nguoi dung theo id (tasks.js se dung de kiem tra nguoi duoc gan)
function findUserById(userId) {
    const user = readUsers().find(function (item) { return item.id === userId; });
    return user ? publicUser(user) : null; // khong tim thay -> null
}

module.exports = {
    signup: signup,
    verifyEmail: verifyEmail,
    login: login,
    logout: logout,
    getUserByToken: getUserByToken,
    listActiveUsers: listActiveUsers,
    findUserById: findUserById,
};

// ============================================================================
// Tu kiem tra: chay bang "npm run auth:test"
// ============================================================================
if (require.main === module) {
    const TEST_EMAIL = 'test.auth.' + Date.now() + '@example.com'; // email rieng cho lan chay nay

    console.log('=== Tu kiem tra auth.js ===');
    console.log('Email dung de test: ' + TEST_EMAIL);
    console.log('Trong luc test, ham gui mail that duoc THAY TAM bang mot ham gia,');
    console.log('nen ban se khong nhan email nao va ket qua chay rat nhanh.');
    console.log('');

    // ---- Thay ham gui mail that bang ham gia (goi la "stub") ----
    // Ly do: test khong can ket noi Gmail, va ta can lay lai token de kich hoat tai khoan.
    // Trong JavaScript, ham nam trong object nen co the gan de thay the nhu the nay.
    let capturedToken = ''; // se chua token ma "email" gia vua nhan
    mail.sendVerifyEmail = async function (email, token) {
        capturedToken = token;      // ghi lai token
        return 'fake-message-id';   // tra ve nhu the da gui thanh cong
    };

    let passed = 0;
    let failed = 0;

    // Chay ham fn va DOI RANG no phai nem loi voi ma HTTP mong doi
    function expectThrow(label, fn, expectedStatus) {
        try {
            fn();                                   // goi ham can kiem tra
            failed++;                               // khong nem loi -> test that bai
            console.log('FAIL: ' + label + ' (dang le phai nem loi ' + expectedStatus + ')');
        } catch (error) {
            if (error.status === expectedStatus) {
                passed++;
                console.log('PASS: ' + label + ' -> ' + error.status + ': ' + error.message);
            } else {
                failed++;
                console.log('FAIL: ' + label + ' (mong doi ' + expectedStatus + ', nhan duoc ' + error.status + ': ' + error.message + ')');
            }
        }
    }

    // Kiep tra gia tri dung
    function expectTrue(label, condition, detail) {
        if (condition) {
            passed++;
            console.log('PASS: ' + label + ' -> ' + detail);
        } else {
            failed++;
            console.log('FAIL: ' + label + ' (' + detail + ')');
        }
    }

    // ---- Nhom 1: kiem tra du lieu dau vao ----
    expectThrow('1. Email sai dinh dang', function () { signup('khong-phai-email', 'Example@123'); }, 400);
    expectThrow('2. Mat khau qua ngan', function () { signup(TEST_EMAIL, 'Ex@1'); }, 400);
    expectThrow('3. Mat khau thieu chu HOA', function () { signup(TEST_EMAIL, 'example@123'); }, 400);
    expectThrow('4. Mat khau thieu chu thuong', function () { signup(TEST_EMAIL, 'EXAMPLE@123'); }, 400);
    expectThrow('5. Mat khau thieu ky tu dac biet', function () { signup(TEST_EMAIL, 'Example12345'); }, 400);

    // ---- Nhom 2: chan trung email ----
    expectThrow('6. Email nam trong 1 trieu email seed', function () {
        signup('seeduser0004242@example.com', 'Example@123');
    }, 409);

    // ---- Nhom 3: dang ky hop le (do ca thoi gian) ----
    const startedAt = Date.now();
    const created = signup(TEST_EMAIL, 'Example@123');
    const signupMs = Date.now() - startedAt;
    expectTrue('7. Dang ky thanh cong, status = pending', created.status === 'pending', 'id=' + created.id + ', status=' + created.status);
    expectTrue('8. Thoi gian dang ky nho hon 500ms', signupMs < 500, signupMs + ' ms (moc cua de bai la 500ms)');
    expectTrue('9. Token da duoc "gui" qua email', capturedToken.length === 48, 'token dai ' + capturedToken.length + ' ky tu hex');

    // ---- Nhom 4: kiem tra du lieu da ghi xuong file ----
    const savedRow = readUsers().find(function (user) { return user.email === TEST_EMAIL; });
    expectTrue('10. Da luu tai khoan vao users.csv', Boolean(savedRow), 'tim thay dong trong file');
    expectTrue('11. Khong luu mat khau goc', savedRow.passwordHash !== 'Example@123' && savedRow.passwordHash.length === 128, 'passwordHash dai ' + savedRow.passwordHash.length + ' ky tu');
    expectTrue('12. Moi tai khoan co salt rieng', savedRow.salt.length === 32, 'salt dai ' + savedRow.salt.length + ' ky tu');

    // ---- Nhom 5: chan dang ky trung ----
    expectThrow('13. Dang ky lai cung email', function () { signup(TEST_EMAIL, 'Example@123'); }, 409);

    // ---- Nhom 6: chua xac thuc thi khong duoc dang nhap ----
    expectThrow('14. Dang nhap khi chua xac thuc', function () { login(TEST_EMAIL, 'Example@123'); }, 403);

    // ---- Nhom 7: kich hoat tai khoan ----
    expectThrow('15. Token xac thuc sai', function () { verifyEmail('token-khong-ton-tai'); }, 400);
    const verified = verifyEmail(capturedToken);
    expectTrue('16. Token dung -> kich hoat thanh cong', verified.email === TEST_EMAIL, 'email=' + verified.email);
    const afterVerify = readUsers().find(function (user) { return user.email === TEST_EMAIL; });
    expectTrue('17. Da doi status thanh active', afterVerify.status === 'active', 'status=' + afterVerify.status);
    expectTrue('18. Da xoa token (link khong dung lai duoc)', afterVerify.verifyToken === '', 'verifyToken = "' + afterVerify.verifyToken + '"');
    expectThrow('19. Bam lai link cu', function () { verifyEmail(capturedToken); }, 400);

    // ---- Nhom 8: dang nhap ----
    expectThrow('20. Dang nhap sai mat khau', function () { login(TEST_EMAIL, 'WrongPass@1'); }, 401);
    expectThrow('21. Dang nhap email khong ton tai', function () { login('khong.co.ai@example.com', 'Example@123'); }, 401);

    const session = login(TEST_EMAIL, 'Example@123');
    expectTrue('22. Dang nhap dung -> co token', session.token.length === 48, 'token dai ' + session.token.length + ' ky tu');
    expectTrue('23. Dang nhap khong tra ve salt/hash', session.user.salt === undefined && session.user.passwordHash === undefined, 'chi tra id, email, status');

    // ---- Nhom 9: dung token de goi API ----
    const me = getUserByToken(session.token);
    expectTrue('24. Token dung -> biet duoc la ai', me.email === TEST_EMAIL, 'email=' + me.email);
    expectThrow('25. Token rac', function () { getUserByToken('token-rac'); }, 401);

    // ---- Nhom 10: dang xuat ----
    logout(session.token);
    expectThrow('26. Dung lai token sau khi dang xuat', function () { getUserByToken(session.token); }, 401);

    // ---- Nhom 11: danh sach nguoi dung de gan viec ----
    const activeUsers = listActiveUsers();
    const hasTestUser = activeUsers.some(function (user) { return user.email === TEST_EMAIL; });
    expectTrue('27. Danh sach user active co tai khoan vua kich hoat', hasTestUser, 'tong ' + activeUsers.length + ' tai khoan active');
    expectTrue('28. Danh sach khong lo salt/hash', activeUsers.every(function (user) { return user.salt === undefined; }), 'chi co id, email, status');

    // ---- Don dep: xoa het tai khoan test khoi users.csv ----
    const keptUsers = readUsers().filter(function (user) { return !user.email.startsWith('test.auth.'); });
    writeCsv(USERS_FILE, USERS_HEADER, keptUsers);

    console.log('');
    console.log('=== KET QUA: ' + passed + ' dat / ' + failed + ' loi ===');
    console.log('Da don sach tai khoan test khoi users.csv (du lieu that giu nguyen).');
    process.exit(failed > 0 ? 1 : 0); // thoat voi ma loi neu co test that bai
}