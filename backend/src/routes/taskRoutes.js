/**
 * ============================================================================
 *  FILE    : backend/src/routes/taskRoutes.js
 *  MỤC ĐÍCH: Bảng định tuyến cho nhóm API công việc (mục 11.2 + 11.3 của đề).
 *  CÁCH DÙNG: server.js gọi handleTaskRoutes(ctx). Hàm trả về:
 *             - true  : request đã được xử lý (khớp route, hoặc 405 do sai method)
 *             - false : không phải route của file này -> server.js tiếp tục tìm route khác
 *  LƯU Ý   : mọi route ở đây ĐỀU YÊU CẦU đăng nhập (requireAuth).
 * ============================================================================
 */

import { sendError, sendErrorFromException } from '../utils/responseUtils.js';               // Hàm phản hồi dùng chung
import { requireAuth } from '../middleware/authMiddleware.js';                               // Middleware xác thực JWT
import {
    handleListUsers,        // GET /api/users
    handleListTasks,        // GET /api/tasks
    handleCreateTask,       // POST /api/tasks
    handleUpdateTask,       // PATCH /api/tasks/:id
    handleDeleteTask,       // DELETE /api/tasks/:id
} from '../controllers/taskController.js';

// Route cố định (không có tham số trong đường dẫn)
const TASK_ROUTES = [
    { method: 'GET', path: '/api/users', handler: handleListUsers },        // Danh sách user active để gán việc
    { method: 'GET', path: '/api/tasks', handler: handleListTasks },        // Danh sách task dùng chung
    { method: 'POST', path: '/api/tasks', handler: handleCreateTask },      // Tạo task mới
];

// Route có tham số /api/tasks/<taskId> -> tra theo method
const TASK_ITEM_METHODS = {
    PATCH: handleUpdateTask,                                                // Sửa task
    DELETE: handleDeleteTask,                                               // Xoá task
};

// Tiền tố nhận diện route có tham số
const TASK_ITEM_PATH_PREFIX = '/api/tasks/';

/**
 * Xử lý request nếu thuộc nhóm route công việc.
 * ctx: { req, res, url, pathname, getBody, user? }
 */
export async function handleTaskRoutes(ctx) {
    const { req, res, pathname } = ctx;                                     // Lấy các thành phần cần dùng từ context

    // --- NHÓM 1: route cố định ---
    const samePath = TASK_ROUTES.filter((route) => route.path === pathname);   // Các route khớp đường dẫn
    if (samePath.length > 0) {                                              // Đúng là route của nhóm này
        const matchedRoute = samePath.find((route) => route.method === req.method);   // Tìm route đúng cả method
        if (!matchedRoute) {                                                  // Đúng path nhưng sai method
            const allowedMethods = samePath.map((route) => route.method).join(', ');    // Liệt kê method được phép
            sendError(res, 405, `Method ${req.method} is not allowed for ${pathname}. Allowed: ${allowedMethods}`);
            return true;                                                        // Đã xử lý (405) -> không tìm tiếp
        }
        try {
            await requireAuth(ctx);                                             // Bắt buộc đăng nhập; gắn ctx.user
            await matchedRoute.handler(ctx);                                    // Gọi controller tương ứng
        } catch (error) {
            sendErrorFromException(res, error, '[task]');                       // 400/401/404 -> giữ mã; lỗi khác -> 500 an toàn
        }
        return true;                                                          // Đã xử lý xong request
    }

    // --- NHÓM 2: route có tham số /api/tasks/<taskId> ---
    if (pathname.startsWith(TASK_ITEM_PATH_PREFIX)) {                       // Đường dẫn bắt đầu bằng /api/tasks/
        const taskId = pathname.slice(TASK_ITEM_PATH_PREFIX.length);          // Phần còn lại chính là ID task
        if (taskId === '' || taskId.includes('/')) return false;              // Không đúng dạng -> nhường server trả 404

        const handler = TASK_ITEM_METHODS[req.method];                        // Tra handler theo method
        if (!handler) {                                                       // Method không được hỗ trợ cho route này
            const allowedMethods = Object.keys(TASK_ITEM_METHODS).join(', ');   // Danh sách method hợp lệ
            sendError(res, 405, `Method ${req.method} is not allowed for /api/tasks/<id>. Allowed: ${allowedMethods}`);
            return true;                                                        // Đã xử lý (405)
        }

        try {
            await requireAuth(ctx);                                             // Bắt buộc đăng nhập
            ctx.taskId = taskId;                                                // Truyền ID task cho controller qua context
            await handler(ctx);                                                 // Gọi controller PATCH hoặc DELETE
        } catch (error) {
            sendErrorFromException(res, error, '[task]');                       // Xử lý lỗi tập trung
        }
        return true;                                                          // Đã xử lý xong request
    }

    return false;                                                           // Không phải route của file này
}