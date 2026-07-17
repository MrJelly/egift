use axum::{
  extract::{
    ws::{Message, WebSocket, WebSocketUpgrade},
    Query, State,
  },
  http::{header, HeaderValue, StatusCode},
  response::{Html, IntoResponse, Response},
  routing::{any, get},
  Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{net::IpAddr, sync::Arc};
use tauri::State as TauriState;
use tokio::sync::{broadcast, oneshot, Mutex, RwLock};
use uuid::Uuid;

const VIEWER_HTML: &str = include_str!("lan_viewer.html");

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanSessionInfo {
  pub url: String,
  pub ip: String,
  pub port: u16,
  pub token: String,
}

struct RunningServer {
  info: LanSessionInfo,
  snapshot: Arc<RwLock<Value>>,
  broadcaster: broadcast::Sender<String>,
  shutdown: Option<oneshot::Sender<()>>,
}

pub struct LanServerState {
  running: Mutex<Option<RunningServer>>,
}

impl Default for LanServerState {
  fn default() -> Self {
    Self {
      running: Mutex::new(None),
    }
  }
}

#[derive(Clone)]
struct ViewerState {
  token: String,
  snapshot: Arc<RwLock<Value>>,
  broadcaster: broadcast::Sender<String>,
}

#[derive(Deserialize)]
struct TokenQuery {
  token: String,
}

#[tauri::command]
pub async fn start_lan_server(
  snapshot: Value,
  state: TauriState<'_, LanServerState>,
) -> Result<LanSessionInfo, String> {
  let mut running = state.running.lock().await;

  if let Some(server) = running.as_mut() {
    *server.snapshot.write().await = snapshot.clone();
    let _ = server.broadcaster.send(snapshot.to_string());
    return Ok(server.info.clone());
  }

  let ip = local_ip_address::local_ip()
    .map_err(|error| format!("无法获取局域网地址：{error}"))?;
  let ip = match ip {
    IpAddr::V4(ip) if !ip.is_loopback() => ip,
    _ => return Err("没有找到可用的 IPv4 局域网地址，请先连接 Wi-Fi 或开启热点".into()),
  };

  let listener = tokio::net::TcpListener::bind("0.0.0.0:0")
    .await
    .map_err(|error| format!("局域网服务启动失败：{error}"))?;
  let port = listener
    .local_addr()
    .map_err(|error| format!("无法读取服务端口：{error}"))?
    .port();
  let token = Uuid::new_v4().simple().to_string();
  let url = format!("http://{ip}:{port}/?token={token}");
  let info = LanSessionInfo {
    url,
    ip: ip.to_string(),
    port,
    token: token.clone(),
  };

  let snapshot = Arc::new(RwLock::new(snapshot));
  let (broadcaster, _) = broadcast::channel(32);
  let viewer_state = ViewerState {
    token,
    snapshot: snapshot.clone(),
    broadcaster: broadcaster.clone(),
  };
  let router = Router::new()
    .route("/", get(viewer_page))
    .route("/api/snapshot", get(snapshot_api))
    .route("/ws", any(websocket_api))
    .with_state(viewer_state);
  let (shutdown_tx, shutdown_rx) = oneshot::channel();

  tauri::async_runtime::spawn(async move {
    let result = axum::serve(listener, router)
      .with_graceful_shutdown(async {
        let _ = shutdown_rx.await;
      })
      .await;
    if let Err(error) = result {
      eprintln!("LAN guest screen stopped with error: {error}");
    }
  });

  *running = Some(RunningServer {
    info: info.clone(),
    snapshot,
    broadcaster,
    shutdown: Some(shutdown_tx),
  });

  Ok(info)
}

#[tauri::command]
pub async fn update_lan_snapshot(
  snapshot: Value,
  state: TauriState<'_, LanServerState>,
) -> Result<bool, String> {
  let running = state.running.lock().await;
  let Some(server) = running.as_ref() else {
    return Ok(false);
  };
  *server.snapshot.write().await = snapshot.clone();
  let _ = server.broadcaster.send(snapshot.to_string());
  Ok(true)
}

#[tauri::command]
pub async fn lan_server_status(
  state: TauriState<'_, LanServerState>,
) -> Result<Option<LanSessionInfo>, String> {
  let running = state.running.lock().await;
  Ok(running.as_ref().map(|server| server.info.clone()))
}

#[tauri::command]
pub async fn stop_lan_server(state: TauriState<'_, LanServerState>) -> Result<(), String> {
  let mut running = state.running.lock().await;
  if let Some(mut server) = running.take() {
    if let Some(shutdown) = server.shutdown.take() {
      let _ = shutdown.send(());
    }
  }
  Ok(())
}

async fn viewer_page(Query(query): Query<TokenQuery>, State(state): State<ViewerState>) -> Response {
  if query.token != state.token {
    return unauthorized();
  }
  let mut response = Html(VIEWER_HTML).into_response();
  response.headers_mut().insert(
    header::CACHE_CONTROL,
    HeaderValue::from_static("no-store, max-age=0"),
  );
  response
}

async fn snapshot_api(Query(query): Query<TokenQuery>, State(state): State<ViewerState>) -> Response {
  if query.token != state.token {
    return unauthorized();
  }
  Json(state.snapshot.read().await.clone()).into_response()
}

async fn websocket_api(
  ws: WebSocketUpgrade,
  Query(query): Query<TokenQuery>,
  State(state): State<ViewerState>,
) -> Response {
  if query.token != state.token {
    return unauthorized();
  }
  ws.on_upgrade(move |socket| websocket_session(socket, state))
    .into_response()
}

async fn websocket_session(mut socket: WebSocket, state: ViewerState) {
  let initial = state.snapshot.read().await.to_string();
  if socket.send(Message::Text(initial.into())).await.is_err() {
    return;
  }

  let mut receiver = state.broadcaster.subscribe();
  loop {
    let payload = match receiver.recv().await {
      Ok(payload) => payload,
      Err(broadcast::error::RecvError::Lagged(_)) => state.snapshot.read().await.to_string(),
      Err(broadcast::error::RecvError::Closed) => break,
    };
    if socket.send(Message::Text(payload.into())).await.is_err() {
      break;
    }
  }
}

fn unauthorized() -> Response {
  (StatusCode::UNAUTHORIZED, "副屏链接无效或已过期").into_response()
}
