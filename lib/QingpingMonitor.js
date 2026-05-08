/**
 * QingpingMonitor.js
 *
 * Qingping Air Monitor 2 (cgllc.airm.cgs2) 와의 miot 프로토콜 통신을 담당.
 * MiioProtocol을 사용해 get_properties 호출로 센서값을 읽어온다.
 */

const MiioProtocol = require('./MiioProtocol.js');

// cgllc.airm.cgs2 의 miot-spec 기반 속성 정의
// https://miot-spec.org/miot-spec-v2/instance?type=urn:miot-spec-v2:device:air-monitor:0000A008:cgllc-cgs2:1
const PROPERTIES = [
  { key: 'humidity',      siid: 3, piid: 1 },  // environment:relative-humidity (%)
  { key: 'pm25',          siid: 3, piid: 4 },  // environment:pm2.5-density (μg/m³)
  { key: 'pm10',          siid: 3, piid: 5 },  // environment:pm10-density (μg/m³)
  { key: 'temperature',   siid: 3, piid: 7 },  // environment:temperature (°C)
  { key: 'co2',           siid: 3, piid: 8 },  // environment:co2-density (ppm)
  { key: 'tvocIndex',     siid: 3, piid: 9 },  // environment:tvoc-density (VOC index 0-500)
  { key: 'batteryLevel',  siid: 4, piid: 1 },  // battery:battery-level (%)
  { key: 'chargingState', siid: 4, piid: 2 },  // battery:charging-state (1=Charging, 2=Not charging, 3=Not chargeable)
];

class QingpingMonitor {
  constructor(ip, token, deviceId, log) {
    this.ip = ip;
    this.token = token;
    this.deviceId = deviceId;
    this.log = log;

    // MiioProtocol에 전달할 logger 어댑터
    const protocolLogger = {
      debug: (msg) => log.debug(msg),
      deepDebug: (msg) => { /* 너무 많아서 무시 */ },
      info: (msg) => log.info(msg),
      warn: (msg) => log.warn(msg),
      error: (msg) => log.error(msg),
    };

    this.protocol = new MiioProtocol(protocolLogger);

    // device 등록 (token만 있어도 첫 핸드셰이크 시 did가 자동으로 채워짐)
    const deviceData = { token: token };
    if (deviceId) {
      deviceData.did = parseInt(deviceId);
    }
    this.protocol.setDevice(ip, deviceData);

    this.connected = false;
  }

  async readAllProperties() {
    const params = PROPERTIES.map(p => ({ siid: p.siid, piid: p.piid }));
    const results = await this.protocol.send(this.ip, 'get_properties', params, {
      timeout: 5000,
      retries: 2,
    });

    if (!Array.isArray(results)) {
      throw new Error('잘못된 get_properties 응답 형식');
    }

    const values = {};
    for (let i = 0; i < PROPERTIES.length; i++) {
      const r = results[i];
      const prop = PROPERTIES[i];
      if (r && r.code === 0 && r.value !== undefined) {
        values[prop.key] = r.value;
      } else if (r && r.code !== 0) {
        this.log.debug(`[QingpingMonitor] ${prop.key} 읽기 실패 (code=${r.code})`);
      }
    }

    // VOC index → μg/m³ 변환 (Sensirion VOC Index 가이드라인 기준)
    // 자세한 식: WELL Building Standard 호환 공식
    if (values.tvocIndex !== undefined) {
      const idx = Math.max(0, Math.min(500, values.tvocIndex));
      let tvoc = (Math.log(501 - idx) - 6.24) * (-996.94);
      if (!isFinite(tvoc) || tvoc < 0) tvoc = 0;
      if (tvoc > 5000) tvoc = 5000; // HomeKit VOCDensity 최대값
      values.tvoc = tvoc;
    }

    this.connected = true;
    return values;
  }

  async getDeviceInfo() {
    try {
      return await this.protocol.getInfo(this.ip);
    } catch (err) {
      this.log.debug(`[QingpingMonitor] getInfo 실패: ${err.message}`);
      return null;
    }
  }

  destroy() {
    if (this.protocol) {
      this.protocol.destroy();
      this.protocol = null;
    }
  }
}

module.exports = QingpingMonitor;
