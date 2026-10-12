// tasks.js
// Nghiệp vụ công việc: xem danh sách, thêm, sửa (nội dung / gán người / tick xong), xoá.
//
// Hai điều cần nhớ:
//   1) tasks.csv KHÔNG lưu email người được gán, chỉ lưu id (cột assignedTo).
//      Email được GHÉP vào lúc đọc danh sách, nên sửa email trong users.csv thì
//      danh sách task tự hiện email mới — không cần sửa file task.
//   2) Khi sửa task (PATCH) chỉ được gửi đúng 3 field: content, assignedTo, completed.
//      Gửi field khác (id, createdBy, createdAt...) bị từ chối 400.
//      Mọi kiểm tra đều làm TRƯỚC khi ghi file -> dữ liệu cũ không bao giờ bị hỏng dở.
//
// Tự kiểm tra file này: npm run tasks:test

const {
    TASKS_FILE,     // đường dẫn data/tasks.csv
    TASKS_HEADER,   // tên các cột của file task
    USERS_FILE,     // cần để ghép email người được gán
    USERS_HEADER,
    readCsv,        // đọc CSV thành mảng object
    writeCsv,       // ghi mảng object xuống CSV
    makeId,         // sinh id ngẫu nhiên
} = require('./store');

const auth = require('./auth'); // dùng auth.findUserById để kiểm tra người được gán

const CONTENT_MAX = 100;                                        // nội dung task tối đa 100 ký tự
const ALLOWED_FIELDS = ['content', 'assignedTo', 'completed'];  // đúng 3 field được phép sửa

// Tạo lỗi kèm mã HTTP để server.js biết phải trả mã nào (giống cách làm ở auth.js)
function httpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

// Đọc toàn bộ file task
function readTasks() {
    return readCsv(TASKS_FILE, TASKS_HEADER);
}

// Dựng bảng tra id -> email, dùng để ghép email người được gán vào từng task
function buildEmailMap() {
    const emailById = new Map();
    for (const user of readCsv(USERS_FILE, USERS_HEADER)) {
        emailById.set(user.id, user.email);
    }
    return emailById;
}

// Đổi 1 dòng trong tasks.csv thành dữ liệu trả cho trình duyệt.
// Lưu ý: file lưu completed dạng chuỗi "true"/"false", ở đây đổi thành boolean thật.
function toPublicTask(row, emailById) {
    const assignedTo = row.assignedTo || '';
    return {
        id: row.id,
        content: row.content,
        createdBy: row.createdBy,
        assignedTo: assignedTo,
        // Chuỗi rỗng = chưa gán ai. Ngược lại tra email; không tìm thấy thì ghi rõ là không rõ.
        assignedToEmail: assignedTo === '' ? '' : (emailById.get(assignedTo) || 'Unknown user'),
        completed: row.completed === 'true',
        createdAt: row.createdAt,
    };
}

// Kiểm tra và chuẩn hoá nội dung task
function checkContent(content) {
    const text = typeof content === 'string' ? content : '';
    const trimmed = text.trim(); // bỏ khoảng trắng hai đầu TRƯỚC khi đo độ dài
    if (trimmed === '') throw httpError(400, 'Noi dung task khong duoc de trong');
    if (trimmed.length > CONTENT_MAX) throw httpError(400, 'Noi dung task toi da ' + CONTENT_MAX + ' ky tu');
    return trimmed;
}

// Kiểm tra người được gán:
//   - chuỗi rỗng "" = bỏ gán -> luôn hợp lệ
//   - ngược lại phải là user TỒN TẠI và ĐANG KÍCH HOẠT (chỉ user active mới được gán việc)
function checkAssignee(assignee) {
    if (typeof assignee !== 'string') throw httpError(400, 'assignedTo phai la id nguoi dung');
    const assigneeId = assignee.trim();
    if (assigneeId === '') return '';              // bỏ gán
    const user = auth.findUserById(assigneeId);    // tra trong users.csv
    if (!user || user.status !== 'active') {
        throw httpError(400, 'Nguoi duoc gan khong ton tai hoac chua kich hoat email');
    }
    return assigneeId;
}

// ---------- 1) Xem danh sách task ----------
function listTasks() {
    const emailById = buildEmailMap();                    // đọc người dùng 1 lần, ghép cho mọi task
    return readTasks().map(function (row) {
        return toPublicTask(row, emailById);
    });
}

// ---------- 2) Thêm task ----------
function addTask(userId, content) {
    const cleanContent = checkContent(content); // sai thì ném lỗi 400, chưa ghi gì

    const newTask = {
        id: makeId('task'),                        // ví dụ: task_3f9a1c2b7d4e
        content: cleanContent,
        createdBy: userId,                         // lấy từ PHIÊN ĐĂNG NHẬP, không lấy từ dữ liệu client gửi
        assignedTo: '',                            // task mới chưa gán cho ai
        completed: 'false',                        // task mới chưa hoàn thành
        createdAt: new Date().toISOString(),
    };

    const tasks = readTasks();
    tasks.push(newTask);
    writeCsv(TASKS_FILE, TASKS_HEADER, tasks);   // ghi xong mới trả kết quả

    return toPublicTask(newTask, new Map());     // Map rỗng vì chắc chắn chưa gán ai
}

// ---------- 3) Sửa task (PATCH) ----------
// changes là object client gửi lên; CHỈ những field CÓ MẶT trong đó mới bị thay đổi.
// Theo đề: không phân quyền chủ sở hữu — user nào đã đăng nhập cũng sửa được mọi task
// (việc "bắt buộc đăng nhập" do server.js kiểm tra trước khi gọi hàm này).
function updateTask(taskId, changes) {
    // Bước 1: changes phải là một object bình thường
    if (changes === null || typeof changes !== 'object' || Array.isArray(changes)) {
        throw httpError(400, 'Du lieu gui len phai la mot object');
    }

    const sentFields = Object.keys(changes);
    if (sentFields.length === 0) {
        throw httpError(400, 'Khong co field nao de cap nhat');
    }

    // Bước 2: chặn field lạ TRƯỚC khi làm bất cứ việc gì
    const badFields = sentFields.filter(function (name) {
        return !ALLOWED_FIELDS.includes(name);
    });
    if (badFields.length > 0) {
        throw httpError(400, 'Khong duoc sua: ' + badFields.join(', ') + '. Chi cho phep: ' + ALLOWED_FIELDS.join(', '));
    }

    // Bước 3: kiểm tra giá trị của từng field được gửi lên, gom vào object prepared.
    // Dùng hasOwnProperty để phân biệt "client gửi chuỗi rỗng" với "client không gửi field này".
    const prepared = {};
    if (Object.prototype.hasOwnProperty.call(changes, 'content')) {
        prepared.content = checkContent(changes.content);
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'assignedTo')) {
        prepared.assignedTo = checkAssignee(changes.assignedTo);
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'completed')) {
        if (typeof changes.completed !== 'boolean') {
            throw httpError(400, 'completed phai la true hoac false (khong nhan chuoi "true")');
        }
        prepared.completed = changes.completed ? 'true' : 'false'; // file CSV lưu dạng chuỗi
    }

    // Bước 4: tìm task cần sửa
    const tasks = readTasks();
    const task = tasks.find(function (item) { return item.id === taskId; });
    if (!task) throw httpError(404, 'Khong tim thay task');

    // Bước 5: ghi đè đúng những field client gửi lên (id, createdBy, createdAt giữ nguyên)
    Object.keys(prepared).forEach(function (name) {
        task[name] = prepared[name];
    });
    writeCsv(TASKS_FILE, TASKS_HEADER, tasks);

    return toPublicTask(task, buildEmailMap());
}

// ---------- 4) Xoá task ----------
function deleteTask(taskId) {
    const tasks = readTasks();
    const index = tasks.findIndex(function (item) { return item.id === taskId; });
    if (index === -1) throw httpError(404, 'Khong tim thay task');

    const removed = tasks[index];   // giữ lại để trả cho client biết đã xoá cái gì
    tasks.splice(index, 1);         // xoá đúng 1 phần tử tại vị trí đó, các task khác giữ nguyên
    writeCsv(TASKS_FILE, TASKS_HEADER, tasks);

    return { id: removed.id, content: removed.content };
}

module.exports = {
    listTasks: listTasks,
    addTask: addTask,
    updateTask: updateTask,
    deleteTask: deleteTask,
};

// ============================================================================
// Tự kiểm tra: chạy bằng "npm run tasks:test"
// Script này KHÔNG gửi email, KHÔNG cần file .env.
// ============================================================================
if (require.main === module) {
    console.log('=== Tu kiem tra tasks.js ===');

    const TEST_USER_ID = 'user_test_active';       // tài khoản giả đã kích hoạt
    const PENDING_USER_ID = 'user_test_pending';   // tài khoản giả CHƯA kích hoạt
    const TEST_EMAIL = 'test.tasks.active@example.com';
    const PENDING_EMAIL = 'test.tasks.pending@example.com';

    // Dọn dữ liệu test: chạy ở đầu script (dọn tàn dư lần trước) và ở cuối script.
    // Nếu script bị lỗi giữa chừng, chỉ cần chạy lại là nó tự dọn sạch.
    function cleanup() {
        const keptUsers = readCsv(USERS_FILE, USERS_HEADER).filter(function (user) {
            return user.id !== TEST_USER_ID && user.id !== PENDING_USER_ID;
        });
        writeCsv(USERS_FILE, USERS_HEADER, keptUsers);

        const keptTasks = readCsv(TASKS_FILE, TASKS_HEADER).filter(function (task) {
            return task.createdBy !== TEST_USER_ID;
        });
        writeCsv(TASKS_FILE, TASKS_HEADER, keptTasks);
    }

    cleanup(); // dọn tàn dư (nếu có) trước khi bắt đầu

    // Đếm số task THẬT đang có, để cuối script kiểm tra dữ liệu thật không bị đụng
    const realTaskCount = readTasks().length;

    // Tạo 2 tài khoản giả bằng cách ghi THẲNG vào users.csv.
    // Cách này giúp test chạy nhanh (không cần đăng ký + gửi email + bấm link).
    const users = readCsv(USERS_FILE, USERS_HEADER);
    users.push({
        id: TEST_USER_ID,
        email: TEST_EMAIL,
        salt: 'test-salt',
        passwordHash: 'test-hash',
        status: 'active',      // đã kích hoạt -> được gán việc
        verifyToken: '',
        createdAt: new Date().toISOString(),
    });
    users.push({
        id: PENDING_USER_ID,
        email: PENDING_EMAIL,
        salt: 'test-salt',
        passwordHash: 'test-hash',
        status: 'pending',     // chưa kích hoạt -> KHÔNG được gán việc
        verifyToken: '',
        createdAt: new Date().toISOString(),
    });
    writeCsv(USERS_FILE, USERS_HEADER, users);

    let passed = 0;
    let failed = 0;

    // Kiểm tra điều kiện đúng
    function expectTrue(label, condition, detail) {
        if (condition) {
            passed++;
            console.log('PASS: ' + label + ' -> ' + detail);
        } else {
            failed++;
            console.log('FAIL: ' + label + ' (' + detail + ')');
        }
    }

    // Kiểm tra hàm PHẢI ném lỗi với mã HTTP mong đợi
    function expectThrow(label, fn, expectedStatus) {
        try {
            fn();
            failed++;
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

    // ---- Nhóm 1: thêm task ----
    const created = addTask(TEST_USER_ID, 'Hoc Node.js co ban');
    expectTrue('1. Them task thanh cong', /^task_[0-9a-f]{12}$/.test(created.id), 'id=' + created.id);
    expectTrue('2. Task moi chua gan ai', created.assignedTo === '' && created.assignedToEmail === '', 'assignedTo = ""');
    expectTrue('3. Task moi chua hoan thanh (boolean)', created.completed === false, 'completed = ' + created.completed);
    expectTrue('4. createdBy lay tu tham so userId', created.createdBy === TEST_USER_ID, 'createdBy = ' + created.createdBy);

    const savedRow = readTasks().find(function (t) { return t.id === created.id; });
    expectTrue('5. Da ghi task xuong tasks.csv', Boolean(savedRow), 'tim thay dong trong file');
    expectTrue('6. File luu completed dang chuoi "false"', savedRow.completed === 'false', 'completed = "' + savedRow.completed + '"');

    expectThrow('7. Noi dung rong', function () { addTask(TEST_USER_ID, '    '); }, 400);
    expectThrow('8. Noi dung qua 100 ky tu', function () { addTask(TEST_USER_ID, 'x'.repeat(101)); }, 400);

    const exact100 = addTask(TEST_USER_ID, 'y'.repeat(100));
    expectTrue('9. Noi dung dung 100 ky tu duoc chap nhan', exact100.content.length === 100, 'do dai = ' + exact100.content.length);

    const tricky = addTask(TEST_USER_ID, '  Luyen tap Node.js, "quotes" tieng Viet  ');
    expectTrue('10. Noi dung duoc trim hai dau', tricky.content === 'Luyen tap Node.js, "quotes" tieng Viet', 'content = "' + tricky.content + '"');
    const trickySaved = readTasks().find(function (t) { return t.id === tricky.id; });
    expectTrue('11. Ghi roi doc lai khong bi vo (dau phay + ngoac kep)', trickySaved.content === tricky.content, 'doc lai dung y nguyen');

    // ---- Nhóm 2: danh sách + ghép email ----
    const foundInList = listTasks().find(function (t) { return t.id === created.id; });
    expectTrue('12. listTasks co task vua them, chua gan ai', foundInList && foundInList.assignedToEmail === '', 'assignedToEmail = ""');

    const assigned = updateTask(created.id, { assignedTo: TEST_USER_ID });
    expectTrue('13. Gan cho user da kich hoat -> hien email', assigned.assignedToEmail === TEST_EMAIL, 'assignedToEmail = ' + assigned.assignedToEmail);

    // ---- Nhóm 3: chặn gán sai ----
    expectThrow('14. Gan cho user CHUA kich hoat', function () { updateTask(created.id, { assignedTo: PENDING_USER_ID }); }, 400);
    expectThrow('15. Gan cho user khong ton tai', function () { updateTask(created.id, { assignedTo: 'user_khong_ton_tai' }); }, 400);

    const notChanged = readTasks().find(function (t) { return t.id === created.id; });
    expectTrue('16. Gan loi KHONG lam thay doi du lieu cu', notChanged.assignedTo === TEST_USER_ID, 'assignedTo van = ' + notChanged.assignedTo);

    const unassigned = updateTask(created.id, { assignedTo: '' });
    expectTrue('17. Bo gan bang chuoi rong', unassigned.assignedTo === '' && unassigned.assignedToEmail === '', 'da bo gan');

    // ---- Nhóm 4: tick hoàn thành ----
    const done = updateTask(created.id, { completed: true });
    expectTrue('18. Tick hoan thanh -> tra ve boolean', done.completed === true, 'completed = ' + done.completed);
    const doneRow = readTasks().find(function (t) { return t.id === created.id; });
    expectTrue('19. File luu chuoi "true"', doneRow.completed === 'true', 'completed = "' + doneRow.completed + '"');

    const reopened = updateTask(created.id, { completed: false });
    expectTrue('20. Mo lai duoc task da hoan thanh', reopened.completed === false, 'completed = ' + reopened.completed);

    expectThrow('21. completed la chuoi "true" (khong phai boolean)', function () { updateTask(created.id, { completed: 'true' }); }, 400);

    // ---- Nhóm 5: chặn field lạ ----
    expectThrow('22. Sua field createdBy', function () { updateTask(created.id, { createdBy: PENDING_USER_ID }); }, 400);
    expectThrow('23. Sua field id', function () { updateTask(created.id, { id: 'task_gia' }); }, 400);
    expectThrow('24. Body rong, khong co field nao', function () { updateTask(created.id, {}); }, 400);
    expectThrow('25. Sua task khong ton tai', function () { updateTask('task_khong_ton_tai', { completed: true }); }, 404);

    // ---- Nhóm 6: sửa nhiều field cùng lúc ----
    const multi = updateTask(created.id, {
        content: 'Da sua ca 3 field',
        assignedTo: TEST_USER_ID,
        completed: true,
    });
    expectTrue('26. Sua nhieu field trong 1 request', multi.content === 'Da sua ca 3 field' && multi.assignedToEmail === TEST_EMAIL && multi.completed === true, 'ca 3 field deu doi');
    expectTrue('27. createdAt khong bi thay doi', multi.createdAt === created.createdAt, 'createdAt giu nguyen');

    const editWhileDone = updateTask(created.id, { content: 'Sua khi da hoan thanh' });
    expectTrue('28. Task da hoan thanh VAN sua duoc', editWhileDone.content === 'Sua khi da hoan thanh' && editWhileDone.completed === true, 'sua duoc, completed van true');

    // ---- Nhóm 7: xoá ----
    const keepTask = addTask(TEST_USER_ID, 'Task de kiem tra xoa dung dong');
    const deleted = deleteTask(created.id);
    expectTrue('29. Xoa tra ve id va noi dung da xoa', deleted.id === created.id, 'id = ' + deleted.id);

    const afterDelete = readTasks();
    expectTrue('30. Task da xoa khong con trong file', !afterDelete.some(function (t) { return t.id === created.id; }), 'da bien mat');
    expectTrue('31. Task khac khong bi xoa theo', afterDelete.some(function (t) { return t.id === keepTask.id; }), 'task khac van con');
    expectThrow('32. Xoa lai cung id do', function () { deleteTask(created.id); }, 404);

    // ---- Nhóm 8: dọn dẹp và kiểm tra dữ liệu thật ----
    cleanup();
    const finalTaskCount = readTasks().length;
    expectTrue('33. Du lieu THAT khong bi anh huong', finalTaskCount === realTaskCount, 'truoc = ' + realTaskCount + ', sau = ' + finalTaskCount);

    console.log('');
    console.log('=== KET QUA: ' + passed + ' dat / ' + failed + ' loi ===');
    console.log('Da don sach du lieu test (2 user gia + moi task do chung tao).');
    process.exit(failed > 0 ? 1 : 0); // thoat voi ma loi neu co test that bai
}