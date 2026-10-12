// ============================================================================
//  FILE    : frontend/script/assign-task.js
//  MỤC ĐÍCH: Xử lý trang Task list (đúng luồng trong ảnh của giảng viên):
//            - Ô nhập task + nút Add.
//            - Mỗi task: checkbox hoàn thành, nội dung, tên user được gán trong
//              ngoặc đơn, nút Edit/Save, nút Assign/Reassign, nút Delete.
//            - Bấm Assign hiện dropdown danh sách user active; chọn xong tên
//              user hiện trong ngoặc đơn cạnh tên task.
//            - Chỉ render dữ liệu bằng textContent (không render HTML thô) để chống XSS.
//            - Token hết hạn (401) -> xoá token và quay về trang Login.
// ============================================================================

const TOKEN_STORAGE_KEY = 'todo_token';                          // Khoá lưu JWT trong localStorage (giống trang Login)
const LOGIN_PAGE_URL = '/page/login.html';                       // Trang Login để quay về khi hết phiên
const MAX_TASK_CONTENT_LENGTH = 100;                             // Nội dung task tối đa 100 ký tự (theo đề bài)

const pageMessage = document.getElementById('message');           // Thông báo chung của trang
const userNameLabel = document.getElementById('user-name');       // Chỗ hiển thị tên user đang đăng nhập
const logoutButton = document.getElementById('logout-button');     // Nút Logout
const addTaskForm = document.getElementById('add-task-form');     // Form thêm task
const taskInput = document.getElementById('task-input');           // Ô nhập nội dung task
const addTaskButton = document.getElementById('add-task-button'); // Nút Add
const taskInputError = document.getElementById('task-input-error');   // Vùng báo lỗi ô nhập task
const addTaskMessage = document.getElementById('add-task-message');   // Thông báo kết quả thêm task
const taskListMessage = document.getElementById('task-list-message'); // Thông báo của danh sách task
const taskListElement = document.getElementById('task-list');     // Thẻ <ul> chứa danh sách task

// Trạng thái của trang (giữ trong RAM, mỗi lần đổi dữ liệu sẽ render lại)
const state = {
    token: localStorage.getItem(TOKEN_STORAGE_KEY),   // JWT đã lưu khi đăng nhập
    currentUser: null,                                // Thông tin user đang đăng nhập (từ /api/me)
    users: [],                                        // Danh sách user active để gán việc
    usersById: new Map(),                             // Map id -> name để tra tên nhanh
    tasks: [],                                        // Danh sách task dùng chung
    editingTaskId: null,                              // ID task đang ở chế độ sửa nội dung (null = không sửa)
    assignOpenTaskId: null,                           // ID task đang mở dropdown chọn user (null = không mở)
};

// --- Các hàm tiện ích UI ---

// Hiển thị thông báo chung của trang
function showPageMessage(text, isSuccess = false) {
    pageMessage.textContent = text;                                  // Chỉ dùng textContent cho an toàn
    pageMessage.classList.toggle('success', isSuccess);               // Đổi màu xanh khi thành công
}

// Hiển thị thông báo ở khu vực "Add task"
function showAddTaskMessage(text, isSuccess = false) {
    addTaskMessage.textContent = text;                                // Gán chữ thuần
    addTaskMessage.classList.toggle('success', isSuccess);             // Đổi màu xanh khi thành công
}

// Hiển thị thông báo ở khu vực "Task list"
function showTaskListMessage(text, isSuccess = false) {
    taskListMessage.textContent = text;                               // Gán chữ thuần
    taskListMessage.classList.toggle('success', isSuccess);            // Đổi màu xanh khi thành công
}

// Xoá token và quay về trang Login (dùng khi token hết hạn hoặc mất hiệu lực)
function redirectToLogin() {
    localStorage.removeItem(TOKEN_STORAGE_KEY);                       // Xoá token hỏng khỏi localStorage
    window.location.href = LOGIN_PAGE_URL;                            // Chuyển về trang Login
}

// Khoá nút trong lúc chờ API để tránh bấm trùng (nếu không truyền nút thì chạy bình thường)
async function runWithButtonLock(button, action) {
    if (!button) { await action(); return; }                          // Không có nút -> chỉ chạy hành động
    if (button.disabled) return;                                      // Nút đang khoá -> bỏ qua lần bấm này
    button.disabled = true;                                           // Khoá nút
    try { await action(); } finally { button.disabled = false; }      // Luôn mở khoá sau khi xong, dù thành công hay lỗi
}

// --- Lớp gọi API dùng chung cho cả trang ---

// Gọi API kèm JWT; nếu gặp 401 thì xoá token và quay về Login
async function apiRequest(method, requestPath, body) {
    const headers = { Authorization: `Bearer ${state.token}` };        // Mọi request đều gửi JWT theo header Bearer
    const options = { method, headers };                               // Cấu hình request
    if (body !== undefined) {                                          // Chỉ thêm body khi có dữ liệu gửi lên
        headers['Content-Type'] = 'application/json';                    // Khai báo body là JSON
        options.body = JSON.stringify(body);                             // Chuyển object thành chuỗi JSON
    }

    const response = await fetch(requestPath, options);                // Gửi request tới API
    let json = null;                                                   // Biến chứa JSON trả về
    try { json = await response.json(); } catch { /* body không phải JSON */ }   // Tránh sập nếu body rỗng/HTML

    if (response.status === 401) {                                     // Token thiếu/hết hạn/bị vô hiệu
        redirectToLogin();                                               // Xoá token và quay về trang Login
        throw new Error('Session is no longer valid');                   // Dừng luồng xử lý hiện tại
    }
    return { status: response.status, ok: response.ok, json };         // Trả kết quả cho nơi gọi
}

// --- Tải dữ liệu từ server ---

// Lấy thông tin user đang đăng nhập từ /api/me
async function loadCurrentUser() {
    const response = await apiRequest('GET', '/api/me');               // Gọi endpoint bảo vệ
    if (!response.ok) throw new Error(`GET /api/me failed with ${response.status}`);   // Lỗi thì báo để nơi gọi xử lý
    state.currentUser = response.json.data;                            // Lưu thông tin user hiện tại
    userNameLabel.textContent = `${state.currentUser.name} (${state.currentUser.email})`;   // Hiển thị trên thanh trên cùng
}

// Lấy danh sách user active để gán việc
async function loadUsers() {
    const response = await apiRequest('GET', '/api/users');            // Gọi API danh sách user active
    if (!response.ok) throw new Error(`GET /api/users failed with ${response.status}`);   // Lỗi thì báo
    state.users = Array.isArray(response.json.data) ? response.json.data : [];            // Lưu mảng user
    state.usersById = new Map(state.users.map((user) => [user.id, user.name]));           // Dựng Map id -> name
}

// Lấy danh sách task dùng chung
async function loadTasks() {
    const response = await apiRequest('GET', '/api/tasks');            // Gọi API danh sách task
    if (!response.ok) throw new Error(`GET /api/tasks failed with ${response.status}`);   // Lỗi thì báo
    state.tasks = Array.isArray(response.json.data) ? response.json.data : [];            // Lưu mảng task
}

// --- Render danh sách task ---

// Cập nhật 1 task trong state sau khi API trả về dữ liệu mới
function applyTaskUpdate(updatedTask) {
    const taskIndex = state.tasks.findIndex((task) => task.id === updatedTask.id);   // Tìm vị trí task trong mảng
    if (taskIndex !== -1) state.tasks[taskIndex] = updatedTask;                      // Thay bằng dữ liệu mới nhất từ server
}

// Tạo nút nhỏ trong dòng task (Edit / Save / Assign / Delete ...)
function createActionButton(label, handleClick, extraClassName = '') {
    const button = document.createElement('button');                   // Tạo thẻ button
    button.type = 'button';                                            // type=button để không submit form ngoài ý muốn
    button.className = `icon-button ${extraClassName}`.trim();         // Gắn class để CSS trang trí
    button.textContent = label;                                        // Chữ trên nút
    button.addEventListener('click', handleClick);                     // Gắn hành động khi bấm
    return button;                                                     // Trả nút cho nơi gọi
}

// Tạo hàng chọn user (dropdown) hiện ra khi bấm nút Assign/Reassign
function buildAssignRow(task) {
    const assignRow = document.createElement('div');                   // Khung chứa dropdown + nút Cancel
    assignRow.className = 'task-assign-row';                           // Class để CSS căn lề

    const hint = document.createElement('span');                       // Chữ nhắc "Assign to:"
    hint.className = 'assign-hint';                                    // Class để CSS làm mờ chữ
    hint.textContent = 'Assign to:';                                   // Nội dung chữ nhắc
    assignRow.append(hint);                                            // Thêm chữ nhắc vào khung

    const select = document.createElement('select');                   // Tạo dropdown chọn user
    select.className = 'assign-select';                                // Class để CSS

    const unassignedOption = document.createElement('option');         // Lựa chọn "chưa gán"
    unassignedOption.value = '';                                       // Giá trị rỗng = bỏ gán (đúng API spec)
    unassignedOption.textContent = 'Unassigned';                       // Chữ hiển thị
    select.append(unassignedOption);                                   // Thêm vào dropdown

    for (const user of state.users) {                                  // Duyệt danh sách user active
        const option = document.createElement('option');                 // Tạo từng lựa chọn user
        option.value = user.id;                                          // Giá trị là ID user
        option.textContent = user.name;                                  // Chữ hiển thị là tên user
        select.append(option);                                           // Thêm vào dropdown
    }
    select.value = task.assignedTo || '';                              // Chọn sẵn user hiện tại của task
    select.addEventListener('change', () => changeAssignee(task, select));   // Đổi lựa chọn -> gọi API gán việc

    const cancelButton = createActionButton('Cancel', () => {          // Nút Cancel đóng dropdown
        state.assignOpenTaskId = null;                                   // Đặt lại trạng thái "không mở dropdown"
        renderTasks();                                                   // Vẽ lại danh sách
    });

    assignRow.append(select, cancelButton);                            // Ghép dropdown + nút Cancel vào khung
    return assignRow;                                                  // Trả khung cho hàm buildTaskItem
}

// Tạo 1 dòng task hoàn chỉnh (checkbox + nội dung + tên user + các nút)
function buildTaskItem(task) {
    const listItem = document.createElement('li');                     // Thẻ <li> cho mỗi task
    listItem.className = 'task-item';                                  // Class để CSS
    listItem.dataset.taskId = task.id;                                 // Lưu ID task vào data-attribute để debug

    const row = document.createElement('div');                         // Hàng chính của task
    row.className = 'task-row';                                        // Class để CSS xếp ngang

    const checkbox = document.createElement('input');                  // Checkbox trạng thái hoàn thành
    checkbox.type = 'checkbox';                                        // Kiểu checkbox
    checkbox.className = 'task-checkbox';                              // Class để CSS
    checkbox.checked = task.completed;                                 // Phản ánh đúng giá trị completed hiện tại
    checkbox.title = 'Mark as completed or incomplete';                // Gợi ý khi rê chuột
    checkbox.addEventListener('change', () => toggleCompleted(task, checkbox));   // Bấm -> gọi API đổi trạng thái

    let contentElement;                                                // Phần tử hiển thị/ sửa nội dung task
    if (state.editingTaskId === task.id) {                             // Task này đang ở chế độ sửa
        contentElement = document.createElement('input');                // Dùng ô input để người dùng sửa
        contentElement.type = 'text';                                    // Kiểu chữ một dòng
        contentElement.className = 'edit-input';                         // Class để CSS
        contentElement.maxLength = MAX_TASK_CONTENT_LENGTH;              // Giới hạn 100 ký tự ngay trên trình duyệt
        contentElement.value = task.content;                             // Điền sẵn nội dung hiện tại
        contentElement.addEventListener('keydown', (event) => {          // Nhấn Enter trong ô sửa
            if (event.key === 'Enter') saveEditedContent(task, contentElement, null);   // Lưu luôn cho nhanh
        });
    } else {                                                           // Chế độ xem bình thường
        contentElement = document.createElement('span');                 // Dùng <span> chỉ để hiển thị
        contentElement.className = task.completed ? 'task-content completed' : 'task-content';   // Gạch ngang nếu đã xong
        contentElement.textContent = task.content;                       // Chỉ dùng textContent -> chống XSS
    }

    const assigneeElement = document.createElement('span');             // Chỗ hiển thị tên user được gán
    assigneeElement.className = 'task-assignee';                       // Class để CSS
    if (task.assignedTo) {                                             // Task đã có người làm
        const assigneeName = task.assignedToName || state.usersById.get(task.assignedTo) || 'Unknown user';   // Ưu tiên tên do server join
        assigneeElement.textContent = `(${assigneeName})`;               // Hiện trong ngoặc đơn đúng như ảnh giảng viên
    } else {
        assigneeElement.textContent = '(unassigned)';                    // Chưa gán ai
    }

    const actions = document.createElement('div');                      // Nhóm nút chức năng bên phải
    actions.className = 'task-actions';                                 // Class để CSS

    if (state.editingTaskId === task.id) {                              // Đang sửa -> hiện nút Save
        const saveButton = createActionButton('Save', () => saveEditedContent(task, contentElement, saveButton));   // Nút Save
        actions.append(saveButton);                                       // Thêm nút Save vào nhóm
    } else {                                                            // Không sửa -> hiện nút Edit
        const editButton = createActionButton('Edit', () => startEditing(task.id));   // Nút Edit (biểu tượng cây bút theo ảnh)
        actions.append(editButton);                                       // Thêm nút Edit
    }

    const assignButton = createActionButton(                            // Nút Assign / Reassign theo ảnh
        task.assignedTo ? 'Reassign' : 'Assign',                          // Có người rồi thì đổi thành Reassign
        () => toggleAssignPanel(task.id),                                 // Bấm -> mở/đóng dropdown chọn user
    );
    actions.append(assignButton);                                       // Thêm nút Assign/Reassign

    const deleteButton = createActionButton(                            // Nút Delete
        'Delete',                                                         // Chữ trên nút
        () => deleteTaskWithConfirm(task, deleteButton),                  // Bấm -> hỏi xác nhận rồi mới xoá
        'danger-button',                                                  // Class đỏ để cảnh báo hành động nguy hiểm
    );
    actions.append(deleteButton);                                       // Thêm nút Delete

    row.append(checkbox, contentElement, assigneeElement, actions);     // Ghép các phần vào hàng chính
    listItem.append(row);                                               // Đưa hàng chính vào <li>

    if (state.assignOpenTaskId === task.id) {                           // Nếu đang mở dropdown cho task này
        listItem.append(buildAssignRow(task));                            // Thêm hàng chọn user ngay bên dưới task
    }
    return listItem;                                                    // Trả về <li> hoàn chỉnh
}

// Vẽ lại toàn bộ danh sách task từ state.tasks
function renderTasks() {
    taskListElement.textContent = '';                                   // Xoá nội dung cũ theo cách an toàn

    if (state.tasks.length === 0) {                                     // Chưa có task nào
        const emptyItem = document.createElement('li');                   // Tạo dòng thông báo rỗng
        emptyItem.className = 'task-empty';                               // Class để CSS
        emptyItem.textContent = 'No tasks yet. Add the first task above.';// Hướng dẫn người dùng
        taskListElement.append(emptyItem);                                // Hiển thị dòng thông báo
        return;                                                          // Kết thúc hàm
    }

    for (const task of state.tasks) {                                   // Duyệt từng task
        taskListElement.append(buildTaskItem(task));                      // Tạo và gắn dòng task vào danh sách
    }
}

// --- Các hành động gọi API ---

// Xử lý khi người dùng bấm nút Add
async function handleAddTask(event) {
    event.preventDefault();                                            // Chặn hành vi tải lại trang của form
    taskInputError.textContent = '';                                   // Xoá lỗi cũ của ô nhập task
    showAddTaskMessage('');                                            // Xoá thông báo kết quả cũ

    const content = taskInput.value.trim();                            // Lấy nội dung đã bỏ khoảng trắng 2 đầu
    if (content === '') {                                              // Nội dung rỗng
        taskInputError.textContent = 'Task content must not be empty';   // Báo lỗi dưới ô nhập
        return;                                                          // Không gọi API
    }
    if (content.length > MAX_TASK_CONTENT_LENGTH) {                    // Nội dung quá 100 ký tự
        taskInputError.textContent = `Task content must be between 1 and ${MAX_TASK_CONTENT_LENGTH} characters`;
        return;                                                          // Không gọi API
    }

    await runWithButtonLock(addTaskButton, async () => {               // Khoá nút Add trong lúc chờ API
        try {
            const response = await apiRequest('POST', '/api/tasks', { content });   // Gọi API tạo task
            if (response.status !== 201) {                                  // Không phải 201 -> có lỗi
                showAddTaskMessage(response.json?.message || `Could not create the task (HTTP ${response.status})`);
                return;                                                       // Kết thúc, không giả báo thành công
            }
            state.tasks.push(response.json.data);                           // Thêm task mới vào state
            taskInput.value = '';                                           // Xoá ô nhập để nhập task tiếp theo
            showAddTaskMessage('Task created successfully', true);          // Báo thành công màu xanh
            renderTasks();                                                  // Vẽ lại danh sách có task mới
        } catch {
            showAddTaskMessage('Cannot reach the server. Please check that the server is running.');   // Lỗi mạng
        }
    });
}

// Bật/tắt trạng thái hoàn thành của task
async function toggleCompleted(task, checkbox) {
    checkbox.disabled = true;                                          // Khoá checkbox trong lúc chờ API
    const newCompletedValue = checkbox.checked;                        // Giá trị mới người dùng vừa chọn
    try {
        const response = await apiRequest('PATCH', `/api/tasks/${task.id}`, { completed: newCompletedValue });   // Gọi API PATCH
        if (!response.ok) {                                              // API từ chối (ví dụ token hết hạn)
            checkbox.checked = !newCompletedValue;                         // Trả checkbox về trạng thái cũ cho đúng dữ liệu
            showTaskListMessage(response.json?.message || `Could not update the task (HTTP ${response.status})`);
            return;                                                        // Kết thúc, không cập nhật state
        }
        applyTaskUpdate(response.json.data);                             // Cập nhật task trong state bằng dữ liệu server trả
        renderTasks();                                                   // Vẽ lại để thấy gạch ngang / bỏ gạch ngang
    } catch {
        checkbox.checked = !newCompletedValue;                           // Lỗi mạng -> trả checkbox về trạng thái cũ
        showTaskListMessage('Cannot reach the server. Please try again.');
    } finally {
        checkbox.disabled = false;                                       // Mở khoá checkbox
    }
}

// Bật chế độ sửa nội dung cho 1 task
function startEditing(taskId) {
    state.editingTaskId = taskId;                                      // Ghi nhớ task đang sửa
    state.assignOpenTaskId = null;                                     // Đóng dropdown gán việc nếu đang mở
    showTaskListMessage('');                                           // Xoá thông báo cũ cho gọn
    renderTasks();                                                     // Vẽ lại để hiện ô input + nút Save
}

// Lưu nội dung task sau khi sửa
async function saveEditedContent(task, inputElement, button) {
    const newContent = inputElement.value.trim();                      // Lấy nội dung mới đã bỏ khoảng trắng 2 đầu
    if (newContent === '') {                                           // Rỗng thì không lưu
        showTaskListMessage('Task content must not be empty');           // Báo lỗi rõ ràng
        return;                                                          // Kết thúc
    }
    if (newContent.length > MAX_TASK_CONTENT_LENGTH) {                 // Quá 100 ký tự thì không lưu
        showTaskListMessage(`Task content must be between 1 and ${MAX_TASK_CONTENT_LENGTH} characters`);
        return;                                                          // Kết thúc
    }

    await runWithButtonLock(button, async () => {                      // Khoá nút Save trong lúc chờ API
        try {
            const response = await apiRequest('PATCH', `/api/tasks/${task.id}`, { content: newContent });   // Gọi API sửa nội dung
            if (!response.ok) {                                            // Lỗi từ server
                showTaskListMessage(response.json?.message || `Could not save the task (HTTP ${response.status})`);
                return;                                                      // Không thoát chế độ sửa để người dùng sửa lại
            }
            applyTaskUpdate(response.json.data);                           // Cập nhật state bằng dữ liệu mới nhất
            state.editingTaskId = null;                                    // Thoát chế độ sửa
            showTaskListMessage('Task updated successfully', true);        // Báo thành công
            renderTasks();                                                 // Vẽ lại danh sách
        } catch {
            showTaskListMessage('Cannot reach the server. Please try again.');   // Lỗi mạng
        }
    });
}

// Mở/đóng dropdown chọn user để gán việc
function toggleAssignPanel(taskId) {
    state.assignOpenTaskId = state.assignOpenTaskId === taskId ? null : taskId;   // Bấm lần 2 thì đóng lại
    state.editingTaskId = null;                                                 // Đóng chế độ sửa nếu đang mở
    renderTasks();                                                              // Vẽ lại danh sách theo trạng thái mới
}

// Đổi người được gán cho task (gọi khi người dùng chọn trong dropdown)
async function changeAssignee(task, selectElement) {
    const newAssigneeId = selectElement.value;                         // ID user vừa chọn ('' = bỏ gán)
    selectElement.disabled = true;                                     // Khoá dropdown trong lúc chờ API
    try {
        const response = await apiRequest('PATCH', `/api/tasks/${task.id}`, { assignedTo: newAssigneeId });   // Gọi API gán việc
        if (!response.ok) {                                              // Bị từ chối (user pending, user lạ...)
            selectElement.value = task.assignedTo || '';                    // Trả dropdown về giá trị cũ
            showTaskListMessage(response.json?.message || `Could not update the assignment (HTTP ${response.status})`);
            return;                                                        // Kết thúc, không đổi state
        }
        applyTaskUpdate(response.json.data);                             // Cập nhật state bằng dữ liệu mới nhất
        state.assignOpenTaskId = null;                                   // Đóng dropdown sau khi gán xong
        showTaskListMessage('Assignment updated successfully', true);    // Báo thành công
        renderTasks();                                                   // Vẽ lại để thấy tên user trong ngoặc đơn
    } catch {
        selectElement.value = task.assignedTo || '';                     // Lỗi mạng -> trả dropdown về giá trị cũ
        showTaskListMessage('Cannot reach the server. Please try again.');
    } finally {
        selectElement.disabled = false;                                  // Mở khoá dropdown
    }
}

// Xoá task sau khi người dùng xác nhận
async function deleteTaskWithConfirm(task, button) {
    const confirmed = window.confirm(`Delete this task?\n\n"${task.content}"\n\nThis action cannot be undone.`);   // Hỏi xác nhận trước khi xoá
    if (!confirmed) return;                                            // Người dùng bấm Cancel -> không làm gì

    await runWithButtonLock(button, async () => {                      // Khoá nút Delete trong lúc chờ API
        try {
            const response = await apiRequest('DELETE', `/api/tasks/${task.id}`);   // Gọi API xoá task
            if (!response.ok) {                                            // Chỉ xoá khỏi UI khi server xác nhận thành công
                showTaskListMessage(response.json?.message || `Could not delete the task (HTTP ${response.status})`);
                return;                                                      // Giữ task trên màn hình
            }
            state.tasks = state.tasks.filter((item) => item.id !== task.id);   // Bỏ task khỏi state
            if (state.editingTaskId === task.id) state.editingTaskId = null;   // Đóng chế độ sửa nếu đang sửa task này
            if (state.assignOpenTaskId === task.id) state.assignOpenTaskId = null;   // Đóng dropdown nếu đang mở
            showTaskListMessage('Task deleted successfully', true);        // Báo thành công
            renderTasks();                                                 // Vẽ lại danh sách không còn task đó
        } catch {
            showTaskListMessage('Cannot reach the server. Please try again.');   // Lỗi mạng
        }
    });
}

// Đăng xuất: gọi API cho đúng spec rồi xoá token ở trình duyệt
async function handleLogout() {
    try {
        await apiRequest('POST', '/api/logout');                         // Gọi API logout (server chỉ xác nhận, không thu hồi JWT)
    } catch {
        /* Bỏ qua lỗi: dù API lỗi vẫn phải xoá token trên trình duyệt */
    }
    localStorage.removeItem(TOKEN_STORAGE_KEY);                        // Xoá JWT khỏi localStorage
    window.location.href = LOGIN_PAGE_URL;                             // Quay về trang Login
}

// --- Khởi động trang ---

// Chạy khi trang vừa tải: kiểm tra đăng nhập rồi nạp dữ liệu
async function startPage() {
    if (!state.token) {                                                // Chưa có token -> bắt buộc đăng nhập
        window.location.href = LOGIN_PAGE_URL;                           // Đưa về trang Login
        return;                                                          // Kết thúc
    }

    try {
        await loadCurrentUser();                                         // Kiểm tra token + lấy thông tin user hiện tại
    } catch {
        showPageMessage('Cannot reach the server. Please check that the server is running.');   // Lỗi mạng hoặc token hỏng
        return;                                                          // Dừng lại, không nạp tiếp dữ liệu
    }

    try {
        await loadUsers();                                               // Nạp danh sách user active để gán việc
        await loadTasks();                                               // Nạp danh sách task dùng chung
        renderTasks();                                                   // Vẽ danh sách task đầu tiên
    } catch {
        showPageMessage('Could not load data from the server. Please reload the page.');        // Báo lỗi rõ ràng
    }
}

// --- Gắn sự kiện ---
addTaskForm.addEventListener('submit', handleAddTask);               // Bấm nút Add
logoutButton.addEventListener('click', handleLogout);                // Bấm nút Logout
startPage();                                                         // Bắt đầu chạy trang