const { Server } = require("socket.io");

let io;
let connect = new Map(); // 所有连接的客户端
let deviceConnect = new Map(); // 设备ID -> socket.id 映射
let webConnect = new Map(); // 网页客户端的socket.id -> socket映射
let deviceSocketMap = new Map(); // 设备socket.id -> deviceId映射

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: "*" },
  });

  io.on("connection", (socket) => {
    connect.set(socket.id, socket);
    console.log(`连接成功 → ${socket.id}`);

    socket.emit("sys:message", {
      type: "connect",
      message: `连接成功 → ${socket.id}`,
      timestamp: Date.now(),
    });

    // 心跳检测
    socket.on("ping", (data) => {
      socket.emit("pong", {
        type: "pong",
        timestamp: Date.now(),
      });
    });

    // 断开连接处理
    socket.on("disconnect", () => {
      console.log(`连接断开 → ${socket.id}`);
      
      // 检查是否为设备连接
      if (deviceSocketMap.has(socket.id)) {
        const deviceId = deviceSocketMap.get(socket.id);
        deviceConnect.delete(deviceId);
        deviceSocketMap.delete(socket.id);
        console.log(`设备断开连接 → ${deviceId}`);
        
        // 通知所有网页客户端设备列表更新
        broadcastDeviceListUpdate();
      }
      
      // 检查是否为网页连接
      if (webConnect.has(socket.id)) {
        webConnect.delete(socket.id);
      }
      
      // 从全局连接列表中移除
      if (connect.has(socket.id)) {
        connect.delete(socket.id);
      }
    });

    // 处理来自Web端的消息
    socket.on("web:login", (data) => {
      console.log(`网页登录请求 → ${socket.id}`, data);
      
      // 简单的登录验证（实际项目中应该更复杂）
      if (data.username && data.password) {
        // 将该连接标记为网页客户端
        webConnect.set(socket.id, socket);
        
        // 返回登录成功消息
        socket.emit("web:login_result", {
          success: true,
          message: "登录成功",
          user: { username: data.username },
          timestamp: Date.now(),
        });
        
        // 立即发送当前设备列表
        sendDeviceList(socket);
      } else {
        socket.emit("web:login_result", {
          success: false,
          message: "用户名和密码不能为空",
          timestamp: Date.now(),
        });
      }
    });

    // 主动获取设备列表
    socket.on("web:get_device_list", (data) => {
      console.log(`网页获取设备列表请求 → ${socket.id}`);
      sendDeviceList(socket);
    });

    // 向设备发送命令
    socket.on("web:device_cmd", (data) => {
      console.log(`网页发送设备命令 → ${socket.id}`, data);
      
      // 验证命令格式
      if (!data.deviceId || !data.command || !data.params) {
        socket.emit("web:cmd_result", {
          success: false,
          message: "命令格式不正确",
          timestamp: Date.now(),
        });
        return;
      }
      
      // 检查设备是否在线
      if (!deviceConnect.has(data.deviceId)) {
        socket.emit("web:cmd_result", {
          success: false,
          message: `设备 ${data.deviceId} 不在线`,
          timestamp: Date.now(),
        });
        return;
      }
      
      // 获取设备的socket.id
      const deviceSocketId = deviceConnect.get(data.deviceId);
      
      // 发送命令到设备
      connect.get(deviceSocketId).emit("device:cmd", {
        command: data.command,
        params: data.params,
        from: socket.id,
        timestamp: Date.now(),
      });
      
      // 返回命令发送成功消息
      socket.emit("web:cmd_result", {
        success: true,
        message: `命令已发送到设备 ${data.deviceId}`,
        timestamp: Date.now(),
      });
    });

    // 处理来自Device端的消息
    socket.on("device:login", (data) => {
      console.log(`设备登录请求 → ${socket.id}`, data);
      
      // 验证设备ID
      if (!data.deviceId) {
        socket.emit("device:login_result", {
          success: false,
          message: "设备ID不能为空",
          timestamp: Date.now(),
        });
        return;
      }
      
      // 检查设备是否已登录
      if (deviceConnect.has(data.deviceId)) {
        const existingSocketId = deviceConnect.get(data.deviceId);
        if (existingSocketId !== socket.id) {
          // 通知已登录的设备断开连接
          if (connect.has(existingSocketId)) {
            connect.get(existingSocketId).emit("sys:message", {
              type: "error",
              message: "该设备已在其他地方登录",
              timestamp: Date.now(),
            });
            connect.get(existingSocketId).disconnect();
          }
        }
      }

      // 注册设备
      deviceConnect.set(data.deviceId, socket.id);
      deviceSocketMap.set(socket.id, data.deviceId);
      
      // 返回登录成功消息
      socket.emit("device:login_result", {
        success: true,
        message: "设备登录成功",
        deviceId: data.deviceId,
        timestamp: Date.now(),
      });
      
      console.log(`设备登录成功 → ${data.deviceId}`);
      
      // 通知所有网页客户端设备列表更新
      broadcastDeviceListUpdate();
    });
    
    // 设备响应命令
    socket.on("device:cmd_result", (data) => {
      console.log(`设备命令响应 → ${socket.id}`, data);
      
      // 检查是否有来源客户端
      if (data.to && connect.has(data.to)) {
        connect.get(data.to).emit("web:device_cmd_result", {
          deviceId: deviceSocketMap.get(socket.id),
          command: data.command,
          success: data.success,
          result: data.result,
          message: data.message,
          timestamp: Date.now(),
        });
      }
    });
  });

  return io;
}

// 发送设备列表给指定客户端
function sendDeviceList(socket) {
  socket.emit("sys:device_list", {
    devices: Array.from(deviceConnect.keys()),
    count: deviceConnect.size,
    timestamp: Date.now(),
  });
}

// 广播设备列表更新给所有网页客户端
function broadcastDeviceListUpdate() {
  webConnect.forEach((socket) => {
    sendDeviceList(socket);
  });
}

module.exports = {
  initSocket,
  getIO: () => io,
};
