/**
 * ============================================================================
 *  FILE    : backend/src/controllers/taskController.js
 *  MỤC ĐÍCH: Tầng controller của nhóm API công việc + danh sách user để gán việc.
 *  ENDPOINT:
 *            - GET    /api/users      : danh sách user active (id, name, email)
 *            - GET    /api/tasks      : danh sách task kèm tên người được gán
 *            - POST   /api/tasks      : tạo task mới
 *            - PATCH  /api/tasks/:id  : sửa nội dung / gán lại / đổi trạng thái hoàn thành
 *            - DELETE /api/tasks/:id  : xoá task
 *  GHI CHÚ : mọi endpoint trong file này đều đi qua middleware requireAuth (route cấu hình).
 * ============================================================================
 */

import { sendSuccess } from '../utils/responseUtils.js';                                    // Quy ước phản hồi dùng chung
import {
    listAssignableUsers,        // Danh sách user active để gán việc
    listTasks,                  // Danh sách task kèm tên người được gán
    createTask,                 // Tạo task mới
    updateTask,                 // Sửa task (content / assignedTo / completed)
    deleteTask,                 // Xoá task
} from '../services/taskService.js';

// --- GET /api/users: danh sách user active cho dropdown gán việc ---
export async function handleListUsers({ res }) {
    const users = await listAssignableUsers();                       // Lấy user active (đã lọc, chỉ field công khai)
    sendSuccess(res, 'Active users retrieved successfully', users, 200);   // Trả về theo quy ước { status, message, data }
}

// --- GET /api/tasks: danh sách task dùng chung của toàn hệ thống ---
export async function handleListTasks({ res }) {
    const tasks = await listTasks();                                 // Lấy toàn bộ task + tên người được gán
    sendSuccess(res, 'Task list retrieved successfully', tasks, 200);      // Trả danh sách cho client
}

// --- POST /api/tasks: tạo task mới (createdBy lấy từ JWT) ---
export async function handleCreateTask({ res, user, getBody }) {
    const body = await getBody();                                    // Đọc JSON body của request
    const task = await createTask({ creatorId: user.id, body });     // user.id đến từ middleware requireAuth, KHÔNG từ body
    sendSuccess(res, 'Task created successfully', task, 201);        // 201 = tạo mới thành công (mục 11.4)
}

// --- PATCH /api/tasks/:id: sửa một phần task ---
export async function handleUpdateTask({ res, taskId, getBody }) {
    const body = await getBody();                                    // Đọc JSON body của request
    const task = await updateTask({ taskId, body });                 // Áp dụng đúng các field được gửi lên
    sendSuccess(res, 'Task updated successfully', task, 200);        // Trả task sau khi cập nhật
}

// --- DELETE /api/tasks/:id: xoá task (frontend phải xác nhận trước khi gọi) ---
export async function handleDeleteTask({ res, taskId }) {
    const task = await deleteTask(taskId);                           // Xoá task khỏi CSV (chỉ xong khi ghi file thành công)
    sendSuccess(res, 'Task deleted successfully', { id: task.id, content: task.content }, 200);   // Trả ID + nội dung đã xoá
}