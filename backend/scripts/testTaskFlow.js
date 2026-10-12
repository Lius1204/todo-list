/**
 * ============================================================================
 *  FILE    : backend/scripts/testTaskFlow.js
 *  MỤC ĐÍCH: Kiểm tra tự động toàn bộ luồng Bước 5:
 *            PHẦN A - tầng service task: giá trị mặc định khi tạo, validate nội dung,
 *                     gán/bỏ gán user, đổi completed, chặn field lạ, 404,
 *                     xoá đúng bản ghi, không giới hạn chủ sở hữu.
 *            PHẦN B - HTTP thật: /api/users, /api/tasks, PATCH, DELETE + xác thực JWT.
 *  CÁCH CHẠY:
 *            1) Terminal 1: npm start
 *            2) Terminal 2: node backend/scripts/testTaskFlow.js
 *  GHI CHÚ : Chỉ tạo user test email bắt đầu bằng "phase5.test." và task do các
 *            user test tạo. Khi chạy xong tự dọn sạch; task của người dùng THẬT
 *            không bị xoá (nếu trỏ tới user test thì chỉ bỏ gán).
 * ============================================================================
 */

import path from 'node:path';                                                            // Ghép đường dẫn file .env
import {
    USERS_CSV_PATH, USERS_HEADERS,                                                         // File users.csv + schema
    TASKS_CSV_PATH, TASKS_HEADERS,                                                         // File tasks.csv + schema
    updateCsvFile, readCsvFile,                                                            // Cập nhật/đọc CSV qua hàng đợi
} from '../src/utils/csvUtils.js';
import { ApiError } from '../src/utils/responseUtils.js';                                // Lớp lỗi nghiệp vụ
import {
    registerUser,            // Đăng ký tài khoản test
    verifyEmailToken,        // Kích hoạt tài khoản test
    loginUser,               // Đăng nhập (kiểm tra nhanh)
    findUserByEmail,         // Đọc dòng user theo email
} from '../src/services/authService.js';
import {
    listTasks,               // Liệt kê task (đã join tên người được gán)
    createTask,              // Tạo task
    updateTask,              // Sửa task
    deleteTask,              // Xoá task
} from '../src/services/taskService.js';

// --- Nạp .env (nếu có) ---
try {
    process.loadEnvFile(path.join(import.meta.dirname, '..', '..', '.env'));               // Đọc .env ở thư mục gốc dự án
} catch {
    console.log('[test] Không tìm thấy .env - dùng biến môi trường của hệ điều hành.');    // Vẫn chạy được test
}

const BASE_URL = `http://localhost:${Number(process.env.PORT || 3000)}`;                 // Địa chỉ server để test HTTP
const TEST_EMAIL_PREFIX = 'phase5.test.';                                                // Tiền tố email test (dùng để dọn dẹp)
const TEST_NAME = 'Phase Five Tester';                                                   // Tên hiển thị của tài khoản test
const VALID_PASSWORD = 'Example@123';                                                    // Mật khẩu đúng quy tắc

let passedCases = 0;                                                                     // Đếm số case đạt
let failedCases = 0;                                                                     // Đếm số case lỗi
let skippedCases = 0;                                                                    // Đếm số case bị bỏ qua (server chưa chạy)

// --- Các helper dùng chung ---

// Tạo email test duy nhất theo nhãn truyền vào
function makeTestEmail(label) {
    return `${TEST_EMAIL_PREFIX}${label}.${Date.now()}@example.com`;                       // Có timestamp -> không bao giờ trùng
}

// Chờ một khoảng thời gian (mili giây)
function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));                    // Trả Promise hoàn thành sau N ms
}

// Chạy 1 case test và in kết quả
async function runCase(caseName, testFunction) {
    try {
        await testFunction();                                                                // Thực thi nội dung kiểm tra
        passedCases += 1;                                                                    // Tăng biến đếm đạt
        console.log(`✅ PASS: ${caseName}`);                                                 // In kết quả đạt
    } catch (error) {
        failedCases += 1;                                                                    // Tăng biến đếm lỗi
        console.log(`❌ FAIL: ${caseName}`);                                                 // In kết quả lỗi
        console.log(`   Lý do: ${error.message}`);                                           // In lý do cụ thể
    }
}

// Kiểm tra điều kiện đúng; sai thì ném lỗi kèm thông báo tiếng Việt
function expect(condition, message) {
    if (!condition) throw new Error(message);                                              // Ném lỗi khi điều kiện sai
}

// Kiểm tra hàm phải ném ApiError đúng mã trạng thái (và chứa phần thông báo nếu truyền vào)
async function expectApiError(callFunction, expectedStatus, expectedPartOfMessage) {
    try {
        await callFunction();                                                                // Gọi hàm cần kiểm tra
    } catch (error) {
        if (!(error instanceof ApiError)) throw new Error(`Lỗi ném ra không phải ApiError (nhận được: ${error.name})`);
        if (error.statusCode !== expectedStatus) throw new Error(`Mã trạng thái sai: ${error.statusCode} (mong đợi ${expectedStatus})`);
        if (expectedPartOfMessage && !error.message.includes(expectedPartOfMessage)) {
            throw new Error(`Thông báo sai: "${error.message}"`);
        }
        return;                                                                              // Đúng như mong đợi
    }
    throw new Error('Không ném lỗi như mong đợi');                                         // Hàm chạy xong không lỗi -> case sai
}

// Gửi request HTTP và trả về status + body text + JSON (nếu có)
async function httpRequest(method, requestPath, { body, token } = {}) {
    const options = { method, headers: {} };                                               // Cấu hình request
    if (token) options.headers.Authorization = `Bearer ${token}`;                          // Gắn JWT nếu cần endpoint bảo vệ
    if (body !== undefined) {                                                              // Có body -> gửi dạng JSON
        options.headers['Content-Type'] = 'application/json';                                // Khai báo kiểu JSON
        options.body = JSON.stringify(body);                                                 // Chuyển object thành chuỗi JSON
    }
    const response = await fetch(`${BASE_URL}${requestPath}`, options);                    // Gọi API bằng fetch của Node.js
    const text = await response.text();                                                    // Đọc body dạng text
    let json = null;                                                                       // Mặc định không có JSON
    try { json = JSON.parse(text); } catch { /* body không phải JSON */ }
    return { status: response.status, text, json };
}

// Tạo tài khoản test ĐÃ ACTIVE (đăng ký -> kích hoạt -> trả thông tin công khai)
async function createActiveTestUser(label) {
    const email = makeTestEmail(label);                                                    // Email test riêng cho nhãn này
    const registered = await registerUser({ name: `${TEST_NAME} ${label}`, email, password: VALID_PASSWORD });   // Đăng ký (pending)
    await verifyEmailToken(registered.verificationToken);                                  // Kích hoạt thành active
    const userRow = await findUserByEmail(email);                                          // Đọc lại dòng trong CSV
    return { id: userRow.id, name: userRow.name, email: userRow.email };                    // Chỉ trả thông tin công khai
}

/**
 * Dọn dẹp dữ liệu test:
 *   1. Xoá toàn bộ user test (email bắt đầu bằng tiền tố), gom ID của họ lại.
 *   2. Xoá task do user test tạo.
 *   3. Task của người dùng thật đang trỏ tới user test -> bỏ gán (assignedTo = '').
 */
async function cleanupTestData() {
    const testUserIds = new Set();                                                         // Tập ID của các user test
    let removedUsers = 0;                                                                  // Đếm số user đã xoá
    await updateCsvFile(USERS_CSV_PATH, USERS_HEADERS, (rows) => {
        const keptRows = [];                                                                 // Mảng giữ lại dữ liệu thật
        for (const row of rows) {                                                            // Duyệt từng dòng user
            if (String(row.email).startsWith(TEST_EMAIL_PREFIX)) {                             // Là user test
                testUserIds.add(row.id);                                                         // Ghi nhớ ID để xử lý task liên quan
                removedUsers += 1;                                                               // Tăng biến đếm
            } else {
                keptRows.push(row);                                                              // Giữ lại user thật
            }
        }
        return keptRows;                                                                     // Ghi lại users.csv không có user test
    });

    let removedTasks = 0;                                                                  // Đếm số task test đã xoá
    let unassignedTasks = 0;                                                               // Đếm số task thật được bỏ gán
    await updateCsvFile(TASKS_CSV_PATH, TASKS_HEADERS, (rows) => {
        const nextRows = [];                                                                 // Mảng kết quả
        for (const row of rows) {                                                            // Duyệt từng task
            if (testUserIds.has(row.createdBy)) { removedTasks += 1; continue; }               // Task do user test tạo -> xoá
            if (row.assignedTo !== '' && testUserIds.has(row.assignedTo)) {                    // Task thật đang gán cho user test
                nextRows.push({ ...row, assignedTo: '' });                                       // Bỏ gán để không trỏ tới user đã xoá
                unassignedTasks += 1;                                                            // Tăng biến đếm
                continue;                                                                        // Sang dòng tiếp theo
            }
            nextRows.push(row);                                                                // Task không liên quan -> giữ nguyên
        }
        return nextRows;                                                                     // Ghi lại tasks.csv
    });

    return { removedUsers, removedTasks, unassignedTasks };                                // Trả thống kê để in ra màn hình
}

// Hàm chính
async function main() {
    console.log('=== BẮT ĐẦU TEST TASK API (BƯỚC 5) ===\n');

    // Dọn tàn dư lần chạy trước (nếu có) TRƯỚC khi tạo dữ liệu mới
    const leftover = await cleanupTestData();                                              // Gọi hàm dọn dẹp
    if (leftover.removedUsers > 0 || leftover.removedTasks > 0) {                          // Nếu có gì cần dọn
        console.log(`[test] Đã dọn tàn dư lần trước: ${leftover.removedUsers} user, ${leftover.removedTasks} task.\n`);
    }

    // Chuẩn bị 2 user active + 1 user pending để test phân quyền và gán việc
    const ownerUser = await createActiveTestUser('owner');                                 // User tạo task chính
    const otherUser = await createActiveTestUser('other');                                 // User được gán / sửa task người khác
    const pendingRegistered = await registerUser({ name: TEST_NAME, email: makeTestEmail('pending'), password: VALID_PASSWORD });   // User chưa kích hoạt
    const pendingUserId = pendingRegistered.user.id;                                       // ID user pending để test chặn gán

    let mainTaskId = '';                                                                   // Task chính dùng xuyên các case phần A
    let httpTaskId = '';                                                                   // Task dùng xuyên các case phần B (HTTP)

    // ===================== PHẦN A: TẦNG SERVICE =====================
    console.log('--- PHẦN A: Tầng service (không cần server đang chạy) ---');

    await runCase('A1. Tạo task: mặc định đúng, ID dạng task_<hex>, createdAt = updatedAt', async () => {
        const createdTask = await createTask({ creatorId: ownerUser.id, body: { content: 'First task' } });   // Tạo task cơ bản
        expect(/^task_[0-9a-f]{16}$/.test(createdTask.id), `ID sai định dạng: ${createdTask.id}`);            // Đúng dạng task_ + 16 hex
        expect(createdTask.content === 'First task', 'Nội dung task bị sai');                                 // Nội dung phải nguyên vẹn
        expect(createdTask.createdBy === ownerUser.id, 'createdBy phải lấy từ tham số creatorId (JWT)');      // Không lấy từ body
        expect(createdTask.assignedTo === '' && createdTask.assignedToName === '', 'Task mới phải chưa gán ai');   // Đúng mục 6.2
        expect(createdTask.completed === false, 'Task mới phải có completed = false (boolean)');              // Boolean thật, không phải chuỗi
        expect(createdTask.createdAt === createdTask.updatedAt, 'Khi vừa tạo, createdAt phải bằng updatedAt'); // Cùng một mốc thời gian
        expect(Number.isFinite(Date.parse(createdTask.createdAt)), 'createdAt phải là ISO 8601 hợp lệ');      // Kiểm tra định dạng thời gian
        const csvRows = await readCsvFile(TASKS_CSV_PATH, TASKS_HEADERS);                                     // Đọc thẳng file CSV
        const storedRow = csvRows.find((row) => row.id === createdTask.id);                                   // Tìm dòng vừa tạo
        expect(storedRow && storedRow.completed === 'false', 'CSV phải lưu completed dạng chuỗi "false"');    // Đúng schema CSV
        mainTaskId = createdTask.id;                                                                          // Lưu ID cho các case sau
    });

    await runCase('A2. Nội dung: trim + giữ Unicode/ngoặc kép; rỗng hoặc quá 100 ký tự bị chặn', async () => {
        const trickyTask = await createTask({ creatorId: ownerUser.id, body: { content: '  Luyện tập Node.js, "quotes" & dấu câu  ' } });
        expect(trickyTask.content === 'Luyện tập Node.js, "quotes" & dấu câu', `Chưa trim/giữ đúng: "${trickyTask.content}"`);   // Trim 2 đầu
        const csvRows = await readCsvFile(TASKS_CSV_PATH, TASKS_HEADERS);                                     // Đọc thẳng CSV để kiểm round-trip
        const storedRow = csvRows.find((row) => row.id === trickyTask.id);                                    // Tìm dòng vừa tạo
        expect(storedRow.content === trickyTask.content, 'Round-trip CSV làm sai nội dung');                  // Ký tự khó phải nguyên vẹn
        await expectApiError(() => createTask({ creatorId: ownerUser.id, body: { content: '    ' } }), 400);  // Toàn khoảng trắng -> 400
        await expectApiError(() => createTask({ creatorId: ownerUser.id, body: { content: 'x'.repeat(101) } }), 400);   // 101 ký tự -> 400
        const exactly100 = await createTask({ creatorId: ownerUser.id, body: { content: 'y'.repeat(100) } }); // Đúng 100 ký tự
        expect(exactly100.content.length === 100, 'Đúng 100 ký tự phải được chấp nhận');                      // Biên trên hợp lệ
    });

    await runCase('A3. Gán cho user active: OK và có tên hiển thị (join từ users.csv)', async () => {
        const assignedTask = await updateTask({ taskId: mainTaskId, body: { assignedTo: otherUser.id } });    // Gán cho otherUser
        expect(assignedTask.assignedTo === otherUser.id, `assignedTo sai: ${assignedTask.assignedTo}`);       // ID phải đúng
        expect(assignedTask.assignedToName === otherUser.name, `assignedToName sai: "${assignedTask.assignedToName}"`);   // Tên join đúng
        const taskFromList = (await listTasks()).find((task) => task.id === mainTaskId);                      // Lấy từ danh sách chung
        expect(taskFromList && taskFromList.assignedToName === otherUser.name, 'listTasks phải join đúng tên người được gán');   // Dữ liệu đồng nhất
    });

    await runCase('A4. Gán user không tồn tại / chưa active -> 400 và KHÔNG đổi dữ liệu cũ', async () => {
        await expectApiError(() => updateTask({ taskId: mainTaskId, body: { assignedTo: 'user_khong_ton_tai' } }), 400, 'does not exist');   // User lạ
        await expectApiError(() => updateTask({ taskId: mainTaskId, body: { assignedTo: pendingUserId } }), 400, 'not an active account');   // User pending
        const taskAfterFailure = (await listTasks()).find((task) => task.id === mainTaskId);                  // Kiểm tra dữ liệu sau khi bị từ chối
        expect(taskAfterFailure.assignedTo === otherUser.id, 'Gán lỗi KHÔNG được làm thay đổi dữ liệu cũ');   // Update phải là all-or-nothing
    });

    await runCase('A5. Bỏ gán bằng chuỗi rỗng -> xoá cả ID lẫn tên hiển thị', async () => {
        const unassignedTask = await updateTask({ taskId: mainTaskId, body: { assignedTo: '' } });            // Bỏ gán theo đúng API spec
        expect(unassignedTask.assignedTo === '' && unassignedTask.assignedToName === '', 'Bỏ gán phải xoá cả ID và tên');   // Cả 2 field cùng trống
    });

    await runCase('A6. completed: true -> boolean + CSV lưu "true"; chuỗi "true" bị chặn 400', async () => {
        const completedTask = await updateTask({ taskId: mainTaskId, body: { completed: true } });            // Đánh dấu hoàn thành
        expect(completedTask.completed === true, 'completed phải trả về boolean true');                       // Không trả chuỗi
        const csvRows = await readCsvFile(TASKS_CSV_PATH, TASKS_HEADERS);                                     // Đọc thẳng CSV
        const storedRow = csvRows.find((row) => row.id === mainTaskId);                                       // Tìm dòng tương ứng
        expect(storedRow.completed === 'true', 'CSV phải lưu completed = "true"');                            // Đúng schema CSV
        const reopenedTask = await updateTask({ taskId: mainTaskId, body: { completed: false } });            // Mở lại task đã xong
        expect(reopenedTask.completed === false, 'Phải mở lại được task đã hoàn thành');                      // Hỗ trợ cả 2 chiều
        await expectApiError(() => updateTask({ taskId: mainTaskId, body: { completed: 'true' } }), 400, 'must be a boolean');   // Chuỗi bị chặn
    });

    await runCase('A7. Chặn field không được phép (id/createdBy/createdAt) và body rỗng', async () => {
        await expectApiError(() => updateTask({ taskId: mainTaskId, body: { id: 'task_hacked' } }), 400, 'Unsupported field');       // Không cho đổi id
        await expectApiError(() => updateTask({ taskId: mainTaskId, body: { createdBy: otherUser.id } }), 400, 'Unsupported field');  // Không cho đổi createdBy
        await expectApiError(() => updateTask({ taskId: mainTaskId, body: { createdAt: '2020-01-01T00:00:00.000Z' } }), 400, 'Unsupported field');   // Không cho đổi createdAt
        await expectApiError(() => updateTask({ taskId: mainTaskId, body: {} }), 400, 'At least one field');                          // PATCH rỗng vô nghĩa
        await expectApiError(() => createTask({ creatorId: ownerUser.id, body: { content: 'Hợp lệ', createdBy: otherUser.id } }), 400, 'Unsupported field');   // POST kèm createdBy
        await expectApiError(() => createTask({ creatorId: ownerUser.id, body: { content: 'Hợp lệ', assignedTo: otherUser.id } }), 400, 'Unsupported field');   // POST kèm assignedTo
        const unchangedTask = (await listTasks()).find((task) => task.id === mainTaskId);                     // Kiểm tra task không bị thay đổi
        expect(unchangedTask.content === 'First task' && unchangedTask.createdBy === ownerUser.id, 'id/createdBy phải bất biến');   // Các field cấm không bị sửa
    });

    await runCase('A8. PATCH nhiều field cùng lúc + updatedAt đổi, createdAt giữ nguyên', async () => {
        const freshTask = await createTask({ creatorId: ownerUser.id, body: { content: 'Multi update base' } });   // Tạo task mới sạch
        await sleep(5);                                                                                       // Chờ 5ms để mốc thời gian khác nhau
        const multiUpdated = await updateTask({
            taskId: freshTask.id,
            body: { content: 'Multi update done', assignedTo: otherUser.id, completed: true },                  // 3 field trong 1 request
        });
        expect(multiUpdated.content === 'Multi update done', 'content chưa được cập nhật');                   // Field 1
        expect(multiUpdated.assignedTo === otherUser.id, 'assignedTo chưa được cập nhật');                    // Field 2
        expect(multiUpdated.completed === true, 'completed chưa được cập nhật');                              // Field 3
        expect(Date.parse(multiUpdated.updatedAt) > Date.parse(freshTask.updatedAt), 'updatedAt phải mới hơn thời điểm tạo');   // Dấu vết sửa
        expect(multiUpdated.createdAt === freshTask.createdAt, 'createdAt phải giữ nguyên');                  // Không được ghi đè createdAt
    });

    await runCase('A9. Task không tồn tại -> 404 khi PATCH và DELETE', async () => {
        await expectApiError(() => updateTask({ taskId: 'task_khong_ton_tai', body: { completed: true } }), 404, 'not found');   // PATCH id lạ
        await expectApiError(() => deleteTask('task_khong_ton_tai'), 404, 'not found');                       // DELETE id lạ
    });

    await runCase('A10. Xoá đúng bản ghi; mọi user active sửa/xoá được task của người khác', async () => {
        const ownerTask = await createTask({ creatorId: ownerUser.id, body: { content: 'Owner task to delete' } });   // Task do ownerUser tạo
        const otherTask = await createTask({ creatorId: otherUser.id, body: { content: 'Other user task to keep' } });   // Task độc lập để kiểm tra

        const editedByOther = await updateTask({ taskId: ownerTask.id, body: { content: 'Edited by another active user' } });   // Sửa chéo chủ sở hữu
        expect(editedByOther.content === 'Edited by another active user', 'KHÔNG được chặn sửa task của người khác');   // Đúng mục 3 của đề

        const deletedTask = await deleteTask(ownerTask.id);                                                   // Xoá task của ownerUser
        expect(deletedTask.id === ownerTask.id, 'Phải trả về đúng task đã xoá');                              // Response khớp thao tác

        const remainingRows = await readCsvFile(TASKS_CSV_PATH, TASKS_HEADERS);                               // Đọc lại CSV để kiểm tra
        expect(!remainingRows.some((row) => row.id === ownerTask.id), 'Task đã xoá vẫn còn trong CSV');       // Bản ghi phải biến mất
        expect(remainingRows.some((row) => row.id === otherTask.id), 'Task khác KHÔNG được bị xoá theo');     // Các task khác nguyên vẹn
    });

    // ===================== PHẦN B: HTTP THẬT =====================
    console.log('\n--- PHẦN B: HTTP thật (cần server đang chạy: npm start) ---');

    let serverIsUp = false;                                                                 // Cờ xác nhận server đang chạy
    try {
        const health = await httpRequest('GET', '/api/health');                               // Gọi endpoint health
        serverIsUp = health.status === 200;                                                   // Server sống nếu trả 200
    } catch {
        serverIsUp = false;                                                                   // Không kết nối được
    }

    if (!serverIsUp) {
        skippedCases += 6;                                                                    // Ghi nhận 6 case bị bỏ qua
        console.log(`⚠️  SKIP: Server chưa chạy ở ${BASE_URL} - hãy chạy "npm start" rồi chạy lại script.`);
    } else {
        const loginResponse = await httpRequest('POST', '/api/login', { body: { email: ownerUser.email, password: VALID_PASSWORD } });
        const ownerToken = loginResponse.json.data.token;                                     // Token của ownerUser (đã active) cho phần B

        await runCase('B1. Thiếu token hoặc token rác -> 401 cho MỌI endpoint task', async () => {
            const requestsWithoutToken = [
                ['GET', '/api/tasks'],                                                            // Danh sách task
                ['GET', '/api/users'],                                                            // Danh sách user để gán
                ['POST', '/api/tasks', { body: { content: 'x' } }],                               // Tạo task
                ['PATCH', '/api/tasks/task_bat_ky', { body: { completed: true } }],               // Sửa task
                ['DELETE', '/api/tasks/task_bat_ky'],                                             // Xoá task
            ];
            for (const [method, apiPath, options] of requestsWithoutToken) {                     // Duyệt từng endpoint
                const response = await httpRequest(method, apiPath, options ?? {});                // Gọi KHÔNG kèm token
                expect(response.status === 401, `${method} ${apiPath} phải trả 401, nhận được ${response.status}`);
            }
            const badTokenResponse = await httpRequest('GET', '/api/tasks', { token: 'khong.phai.jwt' });   // Token rác
            expect(badTokenResponse.status === 401, `Token rác phải 401, nhận được ${badTokenResponse.status}`);
        });

        await runCase('B2. POST /api/tasks -> 201, createdBy lấy từ JWT; gửi kèm createdBy bị chặn 400', async () => {
            const createdResponse = await httpRequest('POST', '/api/tasks', { token: ownerToken, body: { content: '  HTTP created task  ' } });
            expect(createdResponse.status === 201, `Status phải là 201, nhận được ${createdResponse.status}`);   // 201 theo mục 11.4
            expect(createdResponse.json.data.createdBy === ownerUser.id, 'createdBy phải là user trong JWT');     // Không tin client
            expect(createdResponse.json.data.content === 'HTTP created task', 'Nội dung phải được trim');         // Chuẩn hoá đúng
            expect(createdResponse.json.data.completed === false, 'Task mới phải completed = false');             // Giá trị mặc định
            httpTaskId = createdResponse.json.data.id;                                            // Lưu ID cho các case sau

            const hackResponse = await httpRequest('POST', '/api/tasks', { token: ownerToken, body: { content: 'Hack', createdBy: otherUser.id } });
            expect(hackResponse.status === 400, `createdBy trong body phải bị chặn 400, nhận được ${hackResponse.status}`);   // Chống giả mạo
            expect(hackResponse.json.message.includes('Unsupported field'), 'Message phải nói rõ field không được hỗ trợ');
        });

        await runCase('B3. PATCH gán user + completed; GET /api/tasks hiển thị đúng tên và chặn field lạ', async () => {
            const assignResponse = await httpRequest('PATCH', `/api/tasks/${httpTaskId}`, {
                token: ownerToken,
                body: { assignedTo: otherUser.id, completed: true },                                // 2 field trong 1 request
            });
            expect(assignResponse.status === 200, `PATCH phải trả 200, nhận được ${assignResponse.status}`);
            expect(assignResponse.json.data.assignedToName === otherUser.name, 'assignedToName phải là tên otherUser');
            expect(assignResponse.json.data.completed === true, 'completed phải là true');

            const listResponse = await httpRequest('GET', '/api/tasks', { token: ownerToken });   // Đọc lại danh sách chung
            expect(listResponse.status === 200, `GET /api/tasks phải trả 200, nhận được ${listResponse.status}`);
            const foundTask = listResponse.json.data.find((task) => task.id === httpTaskId);      // Tìm task vừa sửa
            expect(foundTask && foundTask.assignedToName === otherUser.name && foundTask.completed === true,
                'GET /api/tasks phải trả đúng dữ liệu sau khi gán');                                // Dữ liệu đồng nhất giữa các API

            const invalidAssignee = await httpRequest('PATCH', `/api/tasks/${httpTaskId}`, { token: ownerToken, body: { assignedTo: 'user_khong_ton_tai' } });
            expect(invalidAssignee.status === 400, `Gán user lạ phải 400, nhận được ${invalidAssignee.status}`);   // Validate qua HTTP

            const unknownField = await httpRequest('PATCH', `/api/tasks/${httpTaskId}`, { token: ownerToken, body: { createdBy: otherUser.id } });
            expect(unknownField.status === 400, `Sửa createdBy phải 400, nhận được ${unknownField.status}`);       // Field cấm bị chặn
        });

        await runCase('B4. DELETE qua HTTP: xoá xong gọi lại 404; danh sách không còn task đó', async () => {
            const firstDelete = await httpRequest('DELETE', `/api/tasks/${httpTaskId}`, { token: ownerToken });   // Xoá lần đầu
            expect(firstDelete.status === 200, `Xoá lần đầu phải 200, nhận được ${firstDelete.status}`);
            const secondDelete = await httpRequest('DELETE', `/api/tasks/${httpTaskId}`, { token: ownerToken });  // Xoá lại cùng ID
            expect(secondDelete.status === 404, `Xoá lần hai phải 404, nhận được ${secondDelete.status}`);
            const listResponse = await httpRequest('GET', '/api/tasks', { token: ownerToken });   // Kiểm tra danh sách
            expect(!listResponse.json.data.some((task) => task.id === httpTaskId), 'Task đã xoá vẫn xuất hiện trong danh sách');   // Không còn dấu vết
        });

        await runCase('B5. GET /api/users: chỉ user active và chỉ 3 field công khai', async () => {
            const usersResponse = await httpRequest('GET', '/api/users', { token: ownerToken });  // Gọi danh sách user
            expect(usersResponse.status === 200, `Status phải là 200, nhận được ${usersResponse.status}`);
            const userList = usersResponse.json.data;                                             // Mảng user trả về
            expect(Array.isArray(userList), 'data phải là mảng');
            expect(userList.some((user) => user.id === ownerUser.id), 'Phải có ownerUser (active)');
            expect(userList.some((user) => user.id === otherUser.id), 'Phải có otherUser (active)');
            expect(!userList.some((user) => user.id === pendingUserId), 'User pending KHÔNG được xuất hiện');   // Chỉ active mới được gán
            for (const user of userList) {                                                        // Kiểm tra từng user trả về
                expect(Object.keys(user).join(',') === 'id,name,email', `Field công khai sai: ${Object.keys(user).join(',')}`);   // Không lộ hash
            }
        });

        await runCase('B6. Task đã hoàn thành vẫn sửa nội dung và xoá được', async () => {
            const createResponse = await httpRequest('POST', '/api/tasks', { token: ownerToken, body: { content: 'Complete then still editable' } });
            const taskId = createResponse.json.data.id;                                           // ID task vừa tạo
            await httpRequest('PATCH', `/api/tasks/${taskId}`, { token: ownerToken, body: { completed: true } });   // Đánh dấu hoàn thành

            const editCompleted = await httpRequest('PATCH', `/api/tasks/${taskId}`, { token: ownerToken, body: { content: 'Edited while completed' } });
            expect(editCompleted.status === 200, `Sửa task đã hoàn thành phải 200, nhận được ${editCompleted.status}`);
            expect(editCompleted.json.data.content === 'Edited while completed' && editCompleted.json.data.completed === true,
                'Task hoàn thành phải sửa được mà vẫn giữ completed = true');                       // Đúng mục 6.2 của đề

            const deleteCompleted = await httpRequest('DELETE', `/api/tasks/${taskId}`, { token: ownerToken });
            expect(deleteCompleted.status === 200, `Xoá task đã hoàn thành phải 200, nhận được ${deleteCompleted.status}`);
        });
    }

    // ===================== DỌN DẸP VÀ TỔNG KẾT =====================
    const cleanupResult = await cleanupTestData();                                          // Xoá user test + task test
    console.log(`\n[test] Đã dọn dẹp: ${cleanupResult.removedUsers} user test, ${cleanupResult.removedTasks} task test, ${cleanupResult.unassignedTasks} task được bỏ gán.`);
    console.log('[test] Dữ liệu thật của bạn (user active + task thật) được giữ nguyên.');

    console.log(`\n=== KẾT QUẢ: ${passedCases} đạt / ${failedCases} lỗi / ${skippedCases} bỏ qua ===`);
    console.log('[test] Các tác vụ gửi email chạy nền có thể in log sau dòng này - đó là hành vi bình thường.');

    await sleep(3000);                                                                      // Chờ 3 giây cho log gửi email nền hiện ra
    process.exit(failedCases > 0 ? 1 : 0);                                                  // Thoát mã lỗi nếu có case thất bại
}

main().catch(async (error) => {                                                           // Bắt lỗi ngoài dự kiến của cả script
    console.error('Lỗi không mong đợi khi chạy test:', error);                              // In đầy đủ để debug
    try { await cleanupTestData(); } catch { /* bỏ qua lỗi khi dọn dẹp */ }                 // Cố gắng dọn dẹp dù có lỗi
    process.exit(1);                                                                        // Thoát với mã lỗi
});