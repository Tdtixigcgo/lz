# 🧧 Lì Xì Platform v3 — Hướng dẫn Deploy

## Tính năng mới v3
- ✅ **Multi-room**: Mỗi người tạo link lì xì riêng
- ✅ **Admin 100% kiểm soát**: Sửa từng ô, mệnh giá, trạng thái
- ✅ **Mệnh giá tùy chỉnh hoàn toàn**: Cài từng ô khác nhau
- ✅ **Ô đặc biệt bí mật**: Hiển thị 10k nhưng thực 500k
- ✅ **Dashboard VIP Pro**: Biểu đồ, timeline, notifications
- ✅ **Realtime**: Mở ô → cập nhật ngay trên mọi màn hình
- ✅ **Export CSV**: Xuất danh sách người chơi

## Bước 1: Setup Database Supabase

1. Vào Supabase → SQL Editor
2. Copy toàn bộ `SETUP_DATABASE.sql` và chạy
3. Kiểm tra đã tạo 3 bảng: `rooms`, `envelopes`, `events`

## Bước 2: Deploy lên Vercel

```bash
# Cài Vercel CLI
npm i -g vercel

# Deploy
cd lixi-v3
vercel --prod
```

Hoặc kéo thả thư mục vào vercel.com

## Bước 3: Sử dụng

### Người dùng tạo phòng:
1. Vào trang chủ → Bấm **"Tạo phòng lì xì"**
2. Điền thông tin, cấu hình mệnh giá
3. Nhận 2 link: **Link phòng** + **Link admin**
4. Chia sẻ Link phòng cho mọi người

### Admin quản lý phòng:
- Vào `/admin/[room-id]` với mật khẩu đã đặt
- Hoặc master admin: username `admin` / pass `admin_lixi_master_2025`

## Cấu trúc URL
```
/                    → Trang chủ (tạo phòng + danh sách)
/room/:roomId        → Trang bốc lì xì
/admin/:roomId       → Admin dashboard phòng cụ thể
/admin               → Master admin (tất cả phòng)
```

## Thay đổi Master Admin Password
Trong `admin.js` dòng 5:
```js
const MASTER_PASS = 'admin_lixi_master_2025'; // Đổi tại đây
```
