// tasks.js
// Trang chính sau khi đăng nhập: xem danh sách, thêm, sửa nội dung, gán / bỏ gán người,
// tick hoàn thành, xoá task. Tất cả nội dung task đều hiển thị bằng textContent
// (chèn chữ thuần) để không bị chèn mã độc.

const TOKEN_KEY = 'todo_token';          // tên khoá lưu token trong localStorage, phải GIỐNG trang login
const LOGIN_PAGE = '/login.html';        // trang sẽ quay về khi chưa đăng nhập hoặc token hết hiệu lực
const CONTENT_MAX = 100;                 // nội dung task tối đa 100 ký tự, giống giới hạn ở server

// ---------- Lấy các phần tử HTML cần dùng, theo đúng id trong tasks.html ----------
const pageMessage = document.getElementById('page-message');    // thông báo chung của trang
const currentUserLabel = document.getElementById('current-user'); // chỗ hiện email người đang đăng nhập
const logoutButton = document.getElementById('logout-button');   // nút Logout
const addForm = document.getElementById('add-form');             // form thêm task
const taskInput = document.getElementById('task-input');         // ô nhập nội dung task
const addButton = document.getElementById('add-button');         // nút Add
const taskInputError = document.getElementById('task-input-error'); // chỗ hiện lỗi ô nhập task
const addMessage = document.getElementById('add-message');       // chỗ hiện kết quả thêm task
const listMessage = document.getElementById('list-message');     // chỗ hiện thông báo danh sách
const taskListElement = document.getElementById('task-list');    // thẻ <ul> chứa danh sách task

// ---------- Trạng thái của trang, giữ trong RAM ----------
// Mỗi lần thay đổi dữ liệu, ta gọi renderTasks() để vẽ lại danh sách từ state này.
const state = {
    token: localStorage.getItem(TOKEN_KEY),  // token đăng nhập đọc từ localStorage
    currentUser: null,                       // thông tin người đang đăng nhập (lấy từ /api/me)
    users: [],                               // danh sách người dùng đã kích hoạt, dùng cho ô chọn Assign
    tasks: [],                               // danh sách task của toàn hệ thống
    editingId: null,                         // id task đang mở chế độ sửa nội dung; null = không sửa task nào
    assignOpenId: null,                      // id task đang mở ô chọn người để gán; null = không mở ô nào
};

// ============================================================================
// PHẦN 1: Các hàm hiển thị thông báo
// ============================================================================

// Hiện thông báo chung ở đầu trang. isSuccess = true thì hiện màu xanh.
function showPageMessage(text, isSuccess) {
    pageMessage.textContent = text;                                              // chèn chữ thuần, không chạy HTML
    pageMessage.className = isSuccess ? 'message success' : 'message';            // đổi class để đổi màu chữ
}

// Hiện thông báo ở khu vực "Add task"
function showAddMessage(text, isSuccess) {
    addMessage.textContent = text;                                               // chèn chữ thuần
    addMessage.className = isSuccess ? 'message success' : 'message';             // đổi màu theo kết quả
}

// Hiện thông báo ở khu vực danh sách task
function showListMessage(text, isSuccess) {
    listMessage.textContent = text;                                              // chèn chữ thuần
    listMessage.className = isSuccess ? 'message success' : 'message';            // đổi màu theo kết quả
}

// ============================================================================
// PHẦN 2: Gọi API và xử lý khi token hết hiệu lực
// ============================================================================

// Xoá token và quay về trang đăng nhập
function goToLogin() {
    localStorage.removeItem(TOKEN_KEY);   // xoá token vì nó đã hết hiệu lực
    window.location.href = LOGIN_PAGE;    // chuyển trình duyệt về trang đăng nhập
}

// Gọi API kèm token. Nếu server trả về 401 (token sai/hết hiệu lực) thì tự về trang đăng nhập.
// method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
// path:   đường dẫn API, ví dụ '/api/tasks'
// body:   dữ liệu gửi lên (bỏ trống với GET/DELETE)
async function api(method, path, body) {
    const options = {                                                   // cấu hình cho hàm fetch
        method: method,                                                   // phương thức HTTP
        headers: { Authorization: 'Bearer ' + state.token },               // gửi token theo header Authorization
    };

    if (body !== undefined) {                                           // chỉ thêm body khi thực sự có dữ liệu gửi lên
        options.headers['Content-Type'] = 'application/json';             // báo cho server biết body là JSON
        options.body = JSON.stringify(body);                              // đổi object thành chuỗi JSON
    }

    const response = await fetch(path, options);                        // gửi request lên server
    let result = null;                                                  // biến chứa dữ liệu JSON trả về
    try {
        result = await response.json();                                   // đọc JSON; server luôn trả JSON cho API
    } catch (error) {
        result = { message: 'Server tra ve du lieu khong doc duoc' };      // trường hợp hiếm: body không phải JSON
    }

    if (response.status === 401) {                                      // token thiếu, sai hoặc đã hết hiệu lực
        goToLogin();                                                      // quay về trang đăng nhập
        throw new Error('Phien dang nhap da het hieu luc');               // dừng luồng xử lý hiện tại
    }

    return { status: response.status, ok: response.ok, data: result };   // trả kết quả cho nơi gọi
}

// ============================================================================
// PHẦN 3: Tải dữ liệu ban đầu khi mở trang
// ============================================================================

// Lấy thông tin người đang đăng nhập và hiện email lên thanh trên cùng
async function loadCurrentUser() {
    const response = await api('GET', '/api/me');                        // hỏi server xem token này của ai
    if (!response.ok) throw new Error(response.data.message);            // không lấy được thì báo lỗi
    state.currentUser = response.data.data;                              // lưu thông tin người dùng vào state
    currentUserLabel.textContent = state.currentUser.email;              // hiện email lên thanh trên cùng
}

// Lấy danh sách người dùng đã kích hoạt, dùng để đổ vào ô chọn Assign
async function loadUsers() {
    const response = await api('GET', '/api/users');                     // gọi API danh sách người dùng
    if (!response.ok) throw new Error(response.data.message);            // lỗi thì dừng
    state.users = response.data.data;                                    // lưu mảng người dùng vào state
}

// Lấy danh sách toàn bộ task
async function loadTasks() {
    const response = await api('GET', '/api/tasks');                     // gọi API danh sách task
    if (!response.ok) throw new Error(response.data.message);            // lỗi thì dừng
    state.tasks = response.data.data;                                    // lưu mảng task vào state
}

// ============================================================================
// PHẦN 4: Vẽ danh sách task ra màn hình
// ============================================================================

// Tạo một nút nhỏ trong dòng task (Edit / Save / Assign / Reassign / Delete / Cancel)
function createActionButton(label, onClick, extraClass) {
    const button = document.createElement('button');                     // tạo thẻ <button> mới
    button.type = 'button';                                              // type=button để không submit form ngoài ý muốn
    button.className = 'icon-button' + (extraClass ? ' ' + extraClass : ''); // ghép class để CSS trang trí
    button.textContent = label;                                          // chữ trên nút
    button.addEventListener('click', onClick);                           // gắn hành động khi bấm nút
    return button;                                                       // trả nút cho nơi gọi
}

// Tạo hàng chọn người để gán việc, chỉ hiện ra khi người dùng bấm nút Assign / Reassign
function buildAssignRow(task) {
    const row = document.createElement('div');                           // khung chứa ô chọn và nút Cancel
    row.className = 'assign-row';                                        // class để CSS căn lề

    const hint = document.createElement('span');                         // chữ nhắc "Assign to:"
    hint.className = 'assign-hint';                                      // class để CSS làm mờ chữ
    hint.textContent = 'Assign to:';                                     // nội dung chữ nhắc
    row.appendChild(hint);                                               // thêm chữ nhắc vào khung

    const select = document.createElement('select');                     // tạo ô chọn (dropdown)
    select.className = 'assign-select';                                  // class để CSS

    const noneOption = document.createElement('option');                 // lựa chọn đầu tiên: chưa gán
    noneOption.value = '';                                               // giá trị rỗng = bỏ gán, đúng như server mong đợi
    noneOption.textContent = '(khong gan)';                              // chữ hiển thị
    select.appendChild(noneOption);                                      // thêm vào dropdown

    for (const user of state.users) {                                    // duyệt danh sách người dùng đã kích hoạt
        const option = document.createElement('option');                   // tạo một lựa chọn cho mỗi người
        option.value = user.id;                                            // giá trị là id người dùng
        option.textContent = user.email;                                   // chữ hiển thị là email (đề không yêu cầu tên)
        select.appendChild(option);                                        // thêm vào dropdown
    }

    select.value = task.assignedTo || '';                                // chọn sẵn người đang được gán của task này
    select.addEventListener('change', function () {                      // khi người dùng đổi lựa chọn
        changeAssignee(task, select);                                      // gọi API để cập nhật người được gán
    });

    const cancelButton = createActionButton('Cancel', function () {      // nút đóng ô chọn
        state.assignOpenId = null;                                         // ghi nhớ là không mở ô chọn nào nữa
        renderTasks();                                                     // vẽ lại danh sách
    });

    row.appendChild(select);                                             // đưa ô chọn vào khung
    row.appendChild(cancelButton);                                        // đưa nút Cancel vào khung
    return row;                                                          // trả khung cho hàm vẽ dòng task
}

// Tạo một dòng task hoàn chỉnh: checkbox + nội dung + email người được gán + các nút
function buildTaskItem(task) {
    const item = document.createElement('li');                           // mỗi task là một thẻ <li>
    item.className = 'task-item';                                        // class để CSS
    item.dataset.taskId = task.id;                                       // lưu id vào thuộc tính data để dễ kiểm tra khi debug

    const row = document.createElement('div');                           // hàng chính của task
    row.className = 'task-row';                                          // class để CSS xếp ngang

    // ---- Checkbox đánh dấu hoàn thành ----
    const checkbox = document.createElement('input');                    // tạo ô tích
    checkbox.type = 'checkbox';                                          // kiểu checkbox
    checkbox.className = 'task-checkbox';                                 // class để CSS
    checkbox.checked = task.completed;                                   // phản ánh đúng trạng thái hiện tại của task
    checkbox.title = 'Danh dau hoan thanh hoac mo lai';                   // chú thích khi rê chuột vào
    checkbox.addEventListener('change', function () {                     // khi người dùng tích hoặc bỏ tích
        toggleCompleted(task, checkbox);                                   // gọi API cập nhật trạng thái
    });

    // ---- Phần nội dung: hoặc là ô nhập (đang sửa), hoặc là chữ (bình thường) ----
    let contentElement;                                                  // biến sẽ chứa phần tử nội dung
    if (state.editingId === task.id) {                                   // task này đang ở chế độ sửa
        contentElement = document.createElement('input');                  // dùng ô nhập để người dùng sửa chữ
        contentElement.type = 'text';                                      // ô nhập một dòng
        contentElement.className = 'edit-input';                           // class để CSS
        contentElement.maxLength = CONTENT_MAX;                            // chặn gõ quá 100 ký tự ngay trên trình duyệt
        contentElement.value = task.content;                               // điền sẵn nội dung hiện tại để sửa
        contentElement.addEventListener('keydown', function (event) {      // bắt sự kiện bàn phím trong ô nhập
            if (event.key === 'Enter') {                                     // nếu người dùng nhấn Enter
                saveContent(task, contentElement, null);                       // lưu luôn cho tiện, không cần bấm nút Save
            }
        });
    } else {                                                             // chế độ xem bình thường
        contentElement = document.createElement('span');                   // dùng thẻ <span> chỉ để hiển thị chữ
        contentElement.className = task.completed ? 'task-content completed' : 'task-content'; // task đã xong thì CSS gạch ngang
        contentElement.textContent = task.content;                         // chèn chữ thuần -> an toàn với dữ liệu người dùng nhập
    }

    // ---- Email người được gán, hiện trong ngoặc đơn cạnh nội dung task ----
    const assigneeElement = document.createElement('span');              // tạo thẻ hiển thị email
    assigneeElement.className = 'task-assignee';                         // class để CSS
    assigneeElement.textContent = task.assignedTo && task.assignedToEmail
        ? '(' + task.assignedToEmail + ')'                                 // có người được gán -> hiện trong ngoặc đơn
        : '(chua gan)';                                                    // chưa gán ai -> ghi rõ để người dùng biết

    // ---- Nhóm nút chức năng bên phải ----
    const actions = document.createElement('div');                       // khung chứa các nút
    actions.className = 'task-actions';                                  // class để CSS

    if (state.editingId === task.id) {                                   // nếu đang sửa thì hiện nút Save
        const saveButton = createActionButton('Save', function () {        // tạo nút Save
            saveContent(task, contentElement, saveButton);                   // bấm Save thì gọi API lưu nội dung mới
        });
        actions.appendChild(saveButton);                                   // đưa nút Save vào nhóm
    } else {                                                            // nếu không sửa thì hiện nút Edit
        const editButton = createActionButton('Edit', function () {        // tạo nút Edit
            state.editingId = task.id;                                       // ghi nhớ đang sửa task này
            state.assignOpenId = null;                                       // đóng ô chọn người nếu đang mở
            showListMessage('', false);                                      // xoá thông báo cũ cho gọn
            renderTasks();                                                   // vẽ lại để thấy ô nhập và nút Save
        });
        actions.appendChild(editButton);                                   // đưa nút Edit vào nhóm
    }

    const assignButton = createActionButton(                             // tạo nút gán người
        task.assignedTo ? 'Reassign' : 'Assign',                           // đã có người rồi thì đổi chữ thành Reassign
        function () {                                                      // khi bấm nút này
            state.assignOpenId = state.assignOpenId === task.id ? null : task.id; // bấm lần hai thì đóng ô chọn
            state.editingId = null;                                          // đóng chế độ sửa nếu đang mở
            renderTasks();                                                   // vẽ lại danh sách theo trạng thái mới
        }
    );
    actions.appendChild(assignButton);                                   // đưa nút gán vào nhóm

    const deleteButton = createActionButton('Delete', function () {       // tạo nút xoá
        deleteTask(task, deleteButton);                                    // bấm thì hỏi xác nhận rồi mới xoá
    }, 'danger-button');                                                 // class đỏ để cảnh báo hành động nguy hiểm
    actions.appendChild(deleteButton);                                   // đưa nút xoá vào nhóm

    // ---- Ghép mọi thứ lại thành một dòng hoàn chỉnh ----
    row.appendChild(checkbox);                                           // ô tích ở ngoài cùng bên trái
    row.appendChild(contentElement);                                     // nội dung task
    row.appendChild(assigneeElement);                                    // email người được gán trong ngoặc đơn
    row.appendChild(actions);                                            // nhóm nút bên phải
    item.appendChild(row);                                               // đưa hàng chính vào thẻ <li>

    if (state.assignOpenId === task.id) {                                // nếu task này đang mở ô chọn người
        item.appendChild(buildAssignRow(task));                            // thêm hàng chọn người ngay bên dưới
    }

    return item;                                                         // trả về thẻ <li> hoàn chỉnh
}

// Vẽ lại toàn bộ danh sách task từ dữ liệu trong state
function renderTasks() {
    taskListElement.textContent = '';                                    // xoá nội dung cũ bằng cách an toàn (không dùng innerHTML)

    if (state.tasks.length === 0) {                                      // trường hợp chưa có task nào
        const emptyItem = document.createElement('li');                    // tạo một dòng thông báo
        emptyItem.className = 'task-empty';                                // class để CSS làm mờ chữ
        emptyItem.textContent = 'Chua co task nao. Hay them task dau tien o tren.'; // hướng dẫn người dùng
        taskListElement.appendChild(emptyItem);                            // hiện dòng thông báo
        return;                                                           // kết thúc hàm, không vẽ gì thêm
    }

    for (const task of state.tasks) {                                    // duyệt từng task trong state
        taskListElement.appendChild(buildTaskItem(task));                   // tạo thẻ <li> và gắn vào danh sách
    }
}

// Cập nhật lại một task trong state sau khi server trả về dữ liệu mới nhất
function updateTaskInState(updatedTask) {
    const index = state.tasks.findIndex(function (item) { return item.id === updatedTask.id; }); // tìm vị trí task
    if (index !== -1) state.tasks[index] = updatedTask;                  // thay bằng dữ liệu mới từ server
}

// ============================================================================
// PHẦN 5: Các hành động gọi API
// ============================================================================

// Thêm task mới khi người dùng bấm nút Add
async function addTask(event) {
    event.preventDefault();                                              // chặn hành vi tải lại trang của form
    taskInputError.textContent = '';                                     // xoá lỗi cũ của ô nhập
    showAddMessage('', false);                                           // xoá thông báo cũ

    const content = taskInput.value.trim();                              // lấy nội dung, bỏ khoảng trắng hai đầu
    if (content === '') {                                                // nội dung rỗng
        taskInputError.textContent = 'Noi dung task khong duoc de trong';  // hiện lỗi dưới ô nhập
        return;                                                           // dừng, không gọi API
    }
    if (content.length > CONTENT_MAX) {                                  // nội dung quá dài
        taskInputError.textContent = 'Noi dung task toi da ' + CONTENT_MAX + ' ky tu'; // hiện lỗi
        return;                                                           // dừng, không gọi API
    }

    addButton.disabled = true;                                           // khoá nút để tránh bấm gửi hai lần
    try {
        const response = await api('POST', '/api/tasks', { content: content }); // gọi API thêm task
        if (response.status !== 201) {                                     // không phải 201 nghĩa là có lỗi
            showAddMessage(response.data.message, false);                    // hiện lời nhắn lỗi của server
            return;                                                         // dừng, không thêm vào danh sách
        }
        state.tasks.push(response.data.data);                              // thêm task mới vào state
        taskInput.value = '';                                              // xoá ô nhập để gõ task tiếp theo
        showAddMessage('Da them task', true);                              // hiện thông báo xanh
        renderTasks();                                                     // vẽ lại danh sách có task mới
    } catch (error) {
        showAddMessage('Khong ket noi duoc server', false);                // lỗi mạng hoặc phiên hết hiệu lực
    } finally {
        addButton.disabled = false;                                        // dù thành công hay lỗi đều mở khoá nút
    }
}

// Tick hoặc bỏ tick hoàn thành của một task
async function toggleCompleted(task, checkbox) {
    checkbox.disabled = true;                                            // khoá checkbox trong lúc chờ server
    const newValue = checkbox.checked;                                   // giá trị mới người dùng vừa chọn

    try {
        const response = await api('PATCH', '/api/tasks/' + task.id, { completed: newValue }); // gọi API cập nhật
        if (!response.ok) {                                                // server từ chối
            checkbox.checked = !newValue;                                    // trả checkbox về trạng thái cũ cho khớp dữ liệu
            showListMessage(response.data.message, false);                   // hiện lời nhắn lỗi
            return;                                                         // dừng, không cập nhật state
        }
        updateTaskInState(response.data.data);                             // cập nhật state bằng dữ liệu server trả về
        renderTasks();                                                     // vẽ lại để thấy gạch ngang hoặc bỏ gạch ngang
    } catch (error) {
        checkbox.checked = !newValue;                                      // lỗi mạng thì cũng trả về trạng thái cũ
    } finally {
        checkbox.disabled = false;                                         // mở khoá checkbox
    }
}

// Lưu nội dung task sau khi người dùng sửa (bấm Save hoặc nhấn Enter)
async function saveContent(task, inputElement, button) {
    const newContent = inputElement.value.trim();                        // lấy nội dung mới, bỏ khoảng trắng hai đầu
    if (newContent === '') {                                             // nội dung rỗng thì không lưu
        showListMessage('Noi dung task khong duoc de trong', false);        // hiện lỗi
        return;                                                           // dừng
    }
    if (newContent.length > CONTENT_MAX) {                               // nội dung quá dài thì không lưu
        showListMessage('Noi dung task toi da ' + CONTENT_MAX + ' ky tu', false); // hiện lỗi
        return;                                                           // dừng
    }

    if (button) button.disabled = true;                                  // khoá nút Save nếu có (trường hợp nhấn Enter thì không có nút)
    try {
        const response = await api('PATCH', '/api/tasks/' + task.id, { content: newContent }); // gọi API sửa nội dung
        if (!response.ok) {                                                // server từ chối
            showListMessage(response.data.message, false);                   // hiện lời nhắn lỗi
            return;                                                         // giữ nguyên chế độ sửa để người dùng sửa lại
        }
        updateTaskInState(response.data.data);                             // cập nhật state bằng dữ liệu mới nhất
        state.editingId = null;                                            // thoát chế độ sửa
        showListMessage('Da cap nhat noi dung task', true);                // hiện thông báo xanh
        renderTasks();                                                     // vẽ lại danh sách
    } catch (error) {
        showListMessage('Khong ket noi duoc server', false);               // lỗi mạng
    } finally {
        if (button) button.disabled = false;                               // mở khoá nút
    }
}

// Đổi người được gán cho task khi người dùng chọn trong ô chọn
async function changeAssignee(task, selectElement) {
    const newAssigneeId = selectElement.value;                           // id người vừa được chọn, rỗng = bỏ gán
    selectElement.disabled = true;                                       // khoá ô chọn trong lúc chờ server

    try {
        const response = await api('PATCH', '/api/tasks/' + task.id, { assignedTo: newAssigneeId }); // gọi API gán người
        if (!response.ok) {                                                // server từ chối, ví dụ người chưa kích hoạt
            selectElement.value = task.assignedTo || '';                     // trả ô chọn về giá trị cũ
            showListMessage(response.data.message, false);                   // hiện lời nhắn lỗi
            return;                                                         // dừng, không đổi state
        }
        updateTaskInState(response.data.data);                             // cập nhật state bằng dữ liệu mới nhất
        state.assignOpenId = null;                                         // đóng ô chọn sau khi gán xong
        showListMessage('Da cap nhat nguoi duoc gan', true);               // hiện thông báo xanh
        renderTasks();                                                     // vẽ lại để thấy email trong ngoặc đơn
    } catch (error) {
        selectElement.value = task.assignedTo || '';                       // lỗi mạng thì trả ô chọn về giá trị cũ
    } finally {
        selectElement.disabled = false;                                    // mở khoá ô chọn
    }
}

// Xoá task sau khi người dùng xác nhận trong hộp thoại
async function deleteTask(task, button) {
    const confirmed = window.confirm('Xoa task nay?\n\n"' + task.content + '"\n\nKhong the hoan tac.'); // hỏi xác nhận trước
    if (!confirmed) return;                                              // người dùng bấm Cancel thì không làm gì

    if (button) button.disabled = true;                                  // khoá nút Delete trong lúc chờ server
    try {
        const response = await api('DELETE', '/api/tasks/' + task.id);     // gọi API xoá task
        if (!response.ok) {                                                // chỉ xoá trên màn hình khi server đã xác nhận
            showListMessage(response.data.message, false);                   // hiện lời nhắn lỗi
            return;                                                         // giữ task lại trên màn hình
        }
        state.tasks = state.tasks.filter(function (item) { return item.id !== task.id; }); // bỏ task khỏi state
        if (state.editingId === task.id) state.editingId = null;            // đóng chế độ sửa nếu đang sửa task này
        if (state.assignOpenId === task.id) state.assignOpenId = null;      // đóng ô chọn người nếu đang mở
        showListMessage('Da xoa task', true);                              // hiện thông báo xanh
        renderTasks();                                                     // vẽ lại danh sách không còn task đó
    } catch (error) {
        showListMessage('Khong ket noi duoc server', false);               // lỗi mạng
    } finally {
        if (button) button.disabled = false;                               // mở khoá nút
    }
}

// Đăng xuất: gọi API để server xoá phiên, rồi xoá token trên trình duyệt
async function logout() {
    try {
        await api('POST', '/api/logout');                                  // server xoá token khỏi danh sách phiên trong RAM
    } catch (error) {
        // Dù API lỗi thì vẫn phải xoá token trên trình duyệt, người dùng vẫn cần thoát ra được
    }
    goToLogin();                                                         // xoá token và quay về trang đăng nhập
}

// ============================================================================
// PHẦN 6: Khởi động trang
// ============================================================================

// Chạy khi trang vừa mở: kiểm tra đăng nhập rồi tải dữ liệu
async function start() {
    if (!state.token) {                                                  // trong máy chưa có token
        goToLogin();                                                       // bắt buộc phải đăng nhập trước
        return;                                                           // kết thúc hàm
    }

    try {
        await loadCurrentUser();                                           // kiểm tra token còn hiệu lực + lấy email người dùng
    } catch (error) {
        showPageMessage('Phien dang nhap khong hop le, hay dang nhap lai', false); // thông báo rõ ràng
        return;                                                           // dừng, không tải tiếp dữ liệu
    }

    try {
        await loadUsers();                                                 // tải danh sách người dùng để gán việc
        await loadTasks();                                                 // tải danh sách task
        renderTasks();                                                     // vẽ danh sách task lần đầu
    } catch (error) {
        showPageMessage('Khong tai duoc du lieu tu server. Hay tai lai trang', false); // lỗi tải dữ liệu
    }
}

// ---------- Gắn sự kiện cho các phần tử ----------
addForm.addEventListener('submit', addTask);                           // bấm nút Add hoặc nhấn Enter trong ô nhập
logoutButton.addEventListener('click', logout);                        // bấm nút Logout

start();                                                               // chạy trang