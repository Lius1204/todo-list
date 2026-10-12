/**
 * ============================================================================
 *  FILE    : backend/src/services/taskService.js
 *  MỤC ĐÍCH: Toàn bộ nghiệp vụ công việc (mục 6.2 + 11.3 của đề bài):
 *            liệt kê task, tạo task, sửa từng phần, gán/bỏ gán người thực hiện,
 *            đánh dấu hoàn thành, xoá task, và liệt kê user active để gán việc.
 *  NGUYÊN TẮC:
 *            - createdBy lấy từ JWT (không bao giờ tin dữ liệu client gửi lên).
 *            - assignedTo phải là user ĐANG ACTIVE hoặc chuỗi rỗng (bỏ gán).
 *            - Nội dung task 1..100 ký tự, không rỗng sau khi trim.
 *            - KHÔNG có giới hạn chủ sở hữu: mọi user active sửa/xoá được MỌI task.
 *            - Tên người được gán được JOIN trong bộ nhớ, không lưu vào tasks.csv.
 * ============================================================================
 */

import { ApiError } from '../utils/responseUtils.js';                                   // Lớp lỗi nghiệp vụ dùng chung
import {
    TASKS_CSV_PATH, TASKS_HEADERS,                                                       // Đường dẫn + schema của tasks.csv
    USERS_CSV_PATH, USERS_HEADERS,                                                       // Đường dẫn + schema của users.csv
    readCsvFile, updateCsvFile,                                                          // Đọc dữ liệu + cập nhật an toàn qua hàng đợi
} from '../utils/csvUtils.js';
import { generateTaskId } from '../utils/idUtils.js';                                   // Sinh ID task duy nhất
import { findUserById } from './authService.js';                                        // Kiểm tra người được gán có tồn tại + active
import {
    assertValidTaskContent,       // Kiểm tra nội dung task (1..100 ký tự, đã trim)
    assertBoolean,                // Kiểm tra field phải là boolean thật
    assertStringField,            // Kiểm tra field phải là chuỗi
    assertJsonObject,             // Kiểm tra body phải là object JSON
    assertOnlyAllowedFields,      // Chặn field lạ (id, createdBy, createdAt...)
    hasField,                     // Kiểm tra body có chứa field cụ thể (dùng cho PATCH)
} from '../utils/validationUtils.js';

// Field được phép gửi khi TẠO task (KHÔNG cho client tự đặt assignedTo/completed/createdBy)
export const ALLOWED_TASK_CREATE_FIELDS = ['content'];

// Field được phép sửa khi CẬP NHẬT task (đúng danh sách trong mục 11.3 của đề)
export const ALLOWED_TASK_UPDATE_FIELDS = ['content', 'assignedTo', 'completed'];

// Chuyển một dòng trong tasks.csv thành dữ liệu an toàn cho client, kèm tên người được gán
function toPublicTask(taskRow, userNamesById) {
    const assignedTo = taskRow.assignedTo ?? '';                                          // Đọc ID người được gán ('' = chưa gán)
    // Tên hiển thị được tra từ Map(user id -> name) - join trong bộ nhớ theo mục 11.3 của đề
    const assignedToName = assignedTo === '' ? '' : (userNamesById.get(assignedTo) ?? 'Unknown user');
    return {
        id: taskRow.id,                                                                     // ID task
        content: taskRow.content,                                                           // Nội dung task
        createdBy: taskRow.createdBy,                                                       // ID người tạo (từ JWT khi tạo)
        assignedTo,                                                                         // ID người được gán, hoặc '' nếu chưa gán
        assignedToName,                                                                     // Tên người được gán để UI hiển thị
        completed: taskRow.completed === 'true',                                            // CSV lưu chuỗi -> đổi thành boolean thật
        createdAt: taskRow.createdAt,                                                       // Thời điểm tạo (ISO 8601)
        updatedAt: taskRow.updatedAt,                                                       // Thời điểm sửa gần nhất (ISO 8601)
    };
}

// Đọc users.csv và trả về Map(id -> name) để join tên người được gán
async function readUserNamesById() {
    const userRows = await readCsvFile(USERS_CSV_PATH, USERS_HEADERS);                    // Đọc toàn bộ người dùng
    return new Map(userRows.map((row) => [row.id, row.name]));                            // Map giúp tra cứu O(1) khi join
}

// Danh sách user ĐANG ACTIVE để hiển thị trong dropdown gán việc (mục 11.2 của đề)
export async function listAssignableUsers() {
    const userRows = await readCsvFile(USERS_CSV_PATH, USERS_HEADERS);                    // Đọc toàn bộ người dùng
    return userRows
        .filter((row) => row.status === 'active')                                           // Chỉ giữ tài khoản đã kích hoạt email
        .map((row) => ({ id: row.id, name: row.name, email: row.email }));                  // Chỉ trả 3 field công khai, KHÔNG trả hash
}

// Lấy toàn bộ task kèm tên người được gán (join trong bộ nhớ, theo mục 11.3)
export async function listTasks() {
    const taskRows = await readCsvFile(TASKS_CSV_PATH, TASKS_HEADERS);                    // Đọc danh sách task dùng chung
    const userNamesById = await readUserNamesById();                                      // Đọc tên user một lần duy nhất để join
    return taskRows.map((row) => toPublicTask(row, userNamesById));                       // Chuyển từng dòng sang dạng công khai
}

// Kiểm tra người được gán: '' = bỏ gán (hợp lệ); ngược lại phải là user tồn tại và ĐANG ACTIVE
async function assertAssignableUser(assigneeId) {
    if (assigneeId === '') return '';                                                     // Bỏ gán là thao tác hợp lệ
    const assignee = await findUserById(assigneeId);                                      // Tìm user theo ID trong users.csv
    if (!assignee || assignee.status !== 'active') {                                      // Không tồn tại hoặc chưa kích hoạt email
        throw new ApiError(400, 'Assigned user does not exist or is not an active account');  // Từ chối gán
    }
    return assigneeId;                                                                    // Hợp lệ -> trả lại ID để lưu
}

// --- Tạo task mới ---
export async function createTask({ creatorId, body }) {
    assertJsonObject(body);                                                               // Body phải là object JSON
    assertOnlyAllowedFields(body, ALLOWED_TASK_CREATE_FIELDS);                            // Chỉ cho phép field "content"
    const content = assertValidTaskContent(body.content);                                 // Kiểm tra nội dung 1..100 ký tự (đã trim)
    const nowIso = new Date().toISOString();                                              // Thời điểm tạo, dùng chung cho createdAt/updatedAt

    const newTaskRow = {
        id: generateTaskId(),                                                               // ID duy nhất sinh ngẫu nhiên (không phụ thuộc số dòng)
        content,                                                                            // Nội dung đã chuẩn hoá
        createdBy: creatorId,                                                               // LUÔN lấy từ JWT, không lấy từ request body
        assignedTo: '',                                                                     // Task mới chưa gán cho ai
        completed: 'false',                                                                 // Task mới luôn chưa hoàn thành
        createdAt: nowIso,                                                                  // Thời điểm tạo
        updatedAt: nowIso,                                                                  // Khi vừa tạo thì updatedAt = createdAt
    };

    await updateCsvFile(TASKS_CSV_PATH, TASKS_HEADERS, (rows) => [...rows, newTaskRow]);  // Ghi vào CSV qua hàng đợi (đã lưu xong mới trả)
    const userNamesById = await readUserNamesById();                                      // Đọc tên user để trả dữ liệu đầy đủ
    return toPublicTask(newTaskRow, userNamesById);                                       // Trả task vừa tạo
}

// --- Cập nhật task kiểu PATCH: chỉ đổi đúng field client thật sự gửi lên ---
export async function updateTask({ taskId, body }) {
    assertJsonObject(body);                                                               // Body phải là object JSON
    assertOnlyAllowedFields(body, ALLOWED_TASK_UPDATE_FIELDS);                            // Chặn id/createdBy/createdAt và mọi field lạ

    const changes = {};                                                                   // Object chứa các thay đổi ĐÃ kiểm tra hợp lệ
    if (hasField(body, 'content')) {                                                      // Client có gửi content
        changes.content = assertValidTaskContent(body.content);                             // Kiểm tra rồi mới đưa vào thay đổi
    }
    if (hasField(body, 'assignedTo')) {                                                   // Client có gửi assignedTo
        const assigneeId = assertStringField(body.assignedTo, 'assignedTo');                // Bắt buộc là chuỗi (cho phép '')
        changes.assignedTo = await assertAssignableUser(assigneeId);                        // '' hoặc user active, nếu không -> 400
    }
    if (hasField(body, 'completed')) {                                                    // Client có gửi completed
        const completedBoolean = assertBoolean(body.completed, 'completed');                // Bắt buộc là boolean thật (không nhận "true")
        changes.completed = completedBoolean ? 'true' : 'false';                            // Đổi sang chuỗi để lưu CSV
    }
    if (Object.keys(changes).length === 0) {                                              // Không có field hợp lệ nào được gửi lên
        throw new ApiError(400, `At least one field must be provided: ${ALLOWED_TASK_UPDATE_FIELDS.join(', ')}`);
    }

    let updatedTaskRow = null;                                                            // Biến giữ dòng sau khi cập nhật
    await updateCsvFile(TASKS_CSV_PATH, TASKS_HEADERS, (rows) => {
        const rowIndex = rows.findIndex((row) => row.id === taskId);                        // Tìm task theo ID
        if (rowIndex === -1) throw new ApiError(404, 'Task not found');                     // Không có -> 404 (mục 11.4)

        updatedTaskRow = {
            ...rows[rowIndex],                                                                // Giữ nguyên id, createdBy, createdAt... (bất biến)
            ...changes,                                                                       // Áp dụng các thay đổi đã kiểm tra
            updatedAt: new Date().toISOString(),                                              // Cập nhật thời điểm sửa gần nhất
        };
        const nextRows = [...rows];                                                         // Tạo mảng mới thay vì sửa mảng hiện có
        nextRows[rowIndex] = updatedTaskRow;                                                // Thay đúng dòng của task cần sửa
        return nextRows;                                                                    // Ghi lại toàn bộ file qua hàng đợi
    });

    const userNamesById = await readUserNamesById();                                      // Đọc tên user để trả dữ liệu đầy đủ
    return toPublicTask(updatedTaskRow, userNamesById);                                   // Trả task sau khi cập nhật
}

// --- Xoá task ---
export async function deleteTask(taskId) {
    let deletedTaskRow = null;                                                            // Biến giữ dòng bị xoá để trả về cho client
    await updateCsvFile(TASKS_CSV_PATH, TASKS_HEADERS, (rows) => {
        const rowIndex = rows.findIndex((row) => row.id === taskId);                        // Tìm task theo ID
        if (rowIndex === -1) throw new ApiError(404, 'Task not found');                     // Không có -> 404
        deletedTaskRow = rows[rowIndex];                                                    // Lưu lại dòng sắp bị xoá
        return rows.filter((row) => row.id !== taskId);                                     // Giữ mọi task khác, chỉ bỏ đúng task này
    });
    return toPublicTask(deletedTaskRow, new Map());                                       // Trả dữ liệu task đã xoá (không cần tên người gán)
}