const crypto = require("crypto");

function key() {
  const secret = process.env.MP_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error("Falta MP_TOKEN_ENCRYPTION_KEY o JWT_SECRET");
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(value) {
  if (!value) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString("base64url")).join(".");
}

function decrypt(value) {
  if (!value) return "";
  const [iv, tag, encrypted] = value.split(".").map(part => Buffer.from(part, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

async function exchangeToken(body) {
  const response = await fetch("https://api.mercadopago.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(data.message || data.error || "Mercado Pago rechazó la conexión");
  }
  return data;
}

async function validAccessToken(business) {
  const connection = business.mercadoPagoConnection;
  if (!connection?.accessToken) throw new Error("MERCADOPAGO_NOT_CONNECTED");
  const expiresSoon = connection.expiresAt && connection.expiresAt.getTime() < Date.now() + 5 * 60 * 1000;
  if (!expiresSoon) return decrypt(connection.accessToken);
  if (!connection.refreshToken) throw new Error("MERCADOPAGO_RECONNECT_REQUIRED");

  const refreshed = await exchangeToken({
    client_id: process.env.MP_CLIENT_ID,
    client_secret: process.env.MP_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: decrypt(connection.refreshToken),
  });
  connection.accessToken = encrypt(refreshed.access_token);
  if (refreshed.refresh_token) connection.refreshToken = encrypt(refreshed.refresh_token);
  connection.expiresAt = new Date(Date.now() + Number(refreshed.expires_in || 15552000) * 1000);
  await business.save();
  return refreshed.access_token;
}

module.exports = { encrypt, exchangeToken, validAccessToken };
