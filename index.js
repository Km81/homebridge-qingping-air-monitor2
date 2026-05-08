/**
 * homebridge-qingping-air-monitor2-km81
 *
 * Qingping Air Monitor 2 (cgllc.airm.cgs2) 전용 Homebridge 플러그인.
 * Homebridge 2.0 호환, 캐시 액세서리 + ConfiguredName 보존 패턴 적용.
 *
 * 본 플러그인은 merdok/homebridge-miot 의 MiioProtocol.js 를 차용했습니다 (MIT 라이선스).
 */

const QingpingMonitor = require('./lib/QingpingMonitor.js');

let Service, Characteristic, Accessory, Homebridge;

const PLUGIN_NAME = 'homebridge-qingping-air-monitor2-km81';
const PLATFORM_NAME = 'QingpingAirMonitor2';
const PLUGIN_VERSION = '1.2.0';

// 기본값
const DEFAULT_POLLING_INTERVAL_SEC = 30;
const DEFAULT_CO2_DETECT_THRESHOLD = 1000; // 이상이면 감지(ABNORMAL)
const DEFAULT_CO2_CLEAR_THRESHOLD = 900;   // 이하면 해제(NORMAL)
const DEFAULT_PM25_BREAKPOINTS = [7, 15, 30, 55]; // EXCELLENT/GOOD/FAIR/INFERIOR/POOR 경계값
const LOW_BATTERY_THRESHOLD = 20;

// 기본 센서 이름
const DEFAULT_NAMES = {
  airQuality:  '공기질',
  temperature: '온도',
  humidity:    '습도',
  co2:         '이산화탄소',
  battery:     '배터리',
};

// 서브타입 (캐시 액세서리에서 서비스 식별/제거에 사용)
const SUBTYPES = {
  airQuality:  'airQualityService',
  temperature: 'temperatureService',
  humidity:    'humidityService',
  co2:         'co2Service',
  battery:     'batteryService',
};

module.exports = function (homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  Accessory = homebridge.platformAccessory;
  Homebridge = homebridge;
  homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, QingpingPlatform);
};

/** 안전한 숫자 포매터: 숫자가 아니면 '?' 를 돌려준다 (로그용). */
function fmtNum(v, digits = 0) {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v.toFixed(digits);
  }
  return '?';
}


/*============================================================================
 *                        Platform
 *============================================================================*/
class QingpingPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.api = api;
    this.config = config || {};
    this.accessories = []; // 캐시된 액세서리 (configureAccessory 에서 채워짐)

    if (this.api) {
      this.api.on('didFinishLaunching', () => {
        this.initDevices();
      });
    }
  }

  /** Homebridge가 캐시 액세서리를 복원할 때 호출됨 */
  configureAccessory(accessory) {
    this.log.debug(`캐시 액세서리 발견: ${accessory.displayName}`);
    this.accessories.push(accessory);
  }

  initDevices() {
    const devices = Array.isArray(this.config.devices) ? this.config.devices : [];

    if (devices.length === 0) {
      this.log.warn('-------------------------------------------');
      this.log.warn('설정에 등록된 장치가 없습니다');
      this.log.warn('config.json 의 platform 항목에 devices 배열을 추가하세요');
      this.log.warn('-------------------------------------------');
      return;
    }

    const usedAccessories = new Set();

    for (const deviceConfig of devices) {
      if (!deviceConfig) continue;
      if (!deviceConfig.ip || !deviceConfig.token) {
        this.log.warn(`장치 설정에 ip 또는 token 이 없습니다: ${JSON.stringify(deviceConfig)}`);
        continue;
      }

      const uuid = this.api.hap.uuid.generate(deviceConfig.token + deviceConfig.ip + PLATFORM_NAME);
      const cached = this.accessories.find(a => a.UUID === uuid);
      if (cached) usedAccessories.add(cached);

      try {
        new QingpingAccessory(this.log, deviceConfig, this.api, cached, this);
      } catch (err) {
        this.log.error(`장치 초기화 실패 (${deviceConfig.name || deviceConfig.ip}): ${err.message}`);
      }
    }

    // 설정에서 빠진 캐시 액세서리는 정리
    const orphans = this.accessories.filter(a => !usedAccessories.has(a));
    if (orphans.length > 0) {
      this.log.info(`사용되지 않는 캐시 액세서리 ${orphans.length}개 제거`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, orphans);
      this.accessories = this.accessories.filter(a => usedAccessories.has(a));
    }
  }
}


/*============================================================================
 *                        Accessory
 *============================================================================*/
class QingpingAccessory {
  constructor(log, config, api, cachedAccessory, platform) {
    this.log = log;
    this.api = api;
    this.config = config;
    this.cachedAccessory = cachedAccessory;
    this.platform = platform;

    // 기본 설정
    this.name = config.name || 'Qingping Air Monitor 2';
    this.ip = config.ip;
    this.token = config.token;
    this.deviceId = config.deviceId;
    this.pollingIntervalMs = (config.pollingInterval || DEFAULT_POLLING_INTERVAL_SEC) * 1000;

    // 센서별 활성화 토글
    this.enableTemperature = config.enableTemperatureSensor !== false;
    this.enableHumidity = config.enableHumiditySensor !== false;
    this.enableAirQuality = config.enableAirQualitySensor !== false;
    this.enableCo2 = config.enableCarbonDioxideSensor !== false;

    // 센서 이름 (사용자가 config 에서 지정한 값 또는 기본값)
    this.sensorNames = {
      airQuality:  (config.airQualitySensorName  || '').trim() || DEFAULT_NAMES.airQuality,
      temperature: (config.temperatureSensorName || '').trim() || DEFAULT_NAMES.temperature,
      humidity:    (config.humiditySensorName    || '').trim() || DEFAULT_NAMES.humidity,
      co2:         (config.co2SensorName         || '').trim() || DEFAULT_NAMES.co2,
      battery:     DEFAULT_NAMES.battery, // 배터리 이름은 변경 옵션 제공 안 함
    };

    // 공기질 등급 경계값 - 개별 필드 우선, 없으면 legacy 배열, 그래도 없으면 기본값
    this.pm25Breakpoints = this.resolvePm25Breakpoints(config);

    // CO2 히스테리시스 임계값
    let co2Detect = config.co2DetectThreshold;
    let co2Clear = config.co2ClearThreshold;
    if (co2Detect === undefined && config.co2AbnormalThreshold !== undefined) {
      co2Detect = config.co2AbnormalThreshold;
      this.log.info(`[${this.name}] 'co2AbnormalThreshold'는 deprecated 입니다. 'co2DetectThreshold' 와 'co2ClearThreshold' 를 사용하세요.`);
    }
    this.co2DetectThreshold = co2Detect || DEFAULT_CO2_DETECT_THRESHOLD;
    this.co2ClearThreshold = co2Clear !== undefined ? co2Clear : Math.round(this.co2DetectThreshold * 0.9);

    // 검증: clear < detect 여야 함
    if (this.co2ClearThreshold >= this.co2DetectThreshold) {
      this.log.warn(`[${this.name}] co2ClearThreshold(${this.co2ClearThreshold}) 는 co2DetectThreshold(${this.co2DetectThreshold})보다 작아야 합니다. 기본값으로 보정합니다.`);
      this.co2DetectThreshold = DEFAULT_CO2_DETECT_THRESHOLD;
      this.co2ClearThreshold = DEFAULT_CO2_CLEAR_THRESHOLD;
    }

    this.UUID = api.hap.uuid.generate(this.token + this.ip + PLATFORM_NAME);

    // 마지막으로 읽은 센서 값 캐시
    this.lastValues = {
      humidity: 0,
      pm25: 0,
      pm10: 0,
      temperature: 0,
      co2: 400,
      tvoc: 0,
      batteryLevel: 100,
      chargingState: 2,
    };

    // CO2 히스테리시스 상태
    this.co2DetectedState = false;

    // 액세서리 준비
    this.initAccessory();

    // 장치 통신 시작
    this.monitor = new QingpingMonitor(this.ip, this.token, this.deviceId, this.log);
    this.startPolling();

    this.log.info(`[${this.name}] 활성화된 센서: ` +
      `${this.enableAirQuality ? `${this.sensorNames.airQuality} ` : ''}` +
      `${this.enableTemperature ? `${this.sensorNames.temperature} ` : ''}` +
      `${this.enableHumidity ? `${this.sensorNames.humidity} ` : ''}` +
      `${this.enableCo2 ? `${this.sensorNames.co2} ` : ''}${this.sensorNames.battery}`);
    this.log.info(`[${this.name}] 공기질 등급 경계값(μg/m³): 매우좋음<${this.pm25Breakpoints[0]} / 좋음<${this.pm25Breakpoints[1]} / 보통<${this.pm25Breakpoints[2]} / 나쁨<${this.pm25Breakpoints[3]} / 매우나쁨≥${this.pm25Breakpoints[3]}`);
    this.log.info(`[${this.name}] CO2 히스테리시스: 감지 ≥ ${this.co2DetectThreshold}ppm, 해제 ≤ ${this.co2ClearThreshold}ppm`);
  }

  /**
   * 신규 4개 필드 (pm25LimitExcellent/Good/Fair/Inferior) 우선,
   * 없으면 legacy 배열 (pm25Breakpoints), 그래도 없으면 기본값.
   * 결과는 항상 4개 정수, 오름차순 정렬.
   */
  resolvePm25Breakpoints(config) {
    const fromIndividual = [
      config.pm25LimitExcellent,
      config.pm25LimitGood,
      config.pm25LimitFair,
      config.pm25LimitInferior,
    ];
    const allDefined = fromIndividual.every(v => Number.isFinite(Number(v)));
    if (allDefined) {
      const arr = fromIndividual.map(v => Number(v)).sort((a, b) => a - b);
      return arr;
    }

    if (Array.isArray(config.pm25Breakpoints) && config.pm25Breakpoints.length === 4) {
      return [...config.pm25Breakpoints].map(v => Number(v)).sort((a, b) => a - b);
    }

    return [...DEFAULT_PM25_BREAKPOINTS];
  }

  /*-------- 액세서리 초기화 --------*/

  initAccessory() {
    if (this.cachedAccessory) {
      this.accessory = this.cachedAccessory;
      this.log.debug(`캐시 액세서리 재사용: ${this.name}`);
    } else {
      this.accessory = new Accessory(this.name, this.UUID, Homebridge.hap.Categories.SENSOR);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [this.accessory]);
      if (this.platform) this.platform.accessories.push(this.accessory);
      this.log.info(`새 액세서리 등록: ${this.name}`);
    }

    // accessory.context 초기화 (Homebridge가 자동으로 캐시 파일에 저장)
    if (!this.accessory.context.serviceNames) {
      this.accessory.context.serviceNames = {};
    }

    this.setupInformationService();

    if (this.enableAirQuality) {
      this.setupAirQualityService();
    } else {
      this.removeServiceBySubtype(Service.AirQualitySensor, SUBTYPES.airQuality, this.sensorNames.airQuality);
    }

    if (this.enableTemperature) {
      this.setupTemperatureService();
    } else {
      this.removeServiceBySubtype(Service.TemperatureSensor, SUBTYPES.temperature, this.sensorNames.temperature);
    }

    if (this.enableHumidity) {
      this.setupHumidityService();
    } else {
      this.removeServiceBySubtype(Service.HumiditySensor, SUBTYPES.humidity, this.sensorNames.humidity);
    }

    if (this.enableCo2) {
      this.setupCarbonDioxideService();
    } else {
      this.removeServiceBySubtype(Service.CarbonDioxideSensor, SUBTYPES.co2, this.sensorNames.co2);
    }

    // 배터리는 항상 활성화
    this.setupBatteryService();
  }

  removeServiceBySubtype(ServiceClass, subType, label) {
    const service = this.accessory.getServiceById(ServiceClass, subType);
    if (service) {
      this.accessory.removeService(service);
      this.log.info(`[${this.name}] ${label} 센서 비활성화 → 액세서리에서 제거됨`);
    }
    // context 에서도 정리
    if (this.accessory.context.serviceNames) {
      delete this.accessory.context.serviceNames[subType];
    }
  }

  /**
   * Helper: 서비스가 캐시에 있으면 재사용, 없으면 새로 만든다.
   *
   * Name / ConfiguredName 정책:
   * - Name characteristic: 매번 plugin 기본값으로 갱신 (HomeKit fallback)
   * - ConfiguredName characteristic:
   *   * 첫 생성 시: config 이름으로 초기 설정
   *   * 이후 재시작 시:
   *     - config 이름이 이전과 동일하면 → ConfiguredName 건드리지 않음
   *       (사용자가 Home 앱에서 변경한 이름이 보존됨)
   *     - config 이름이 변경됐다면 → ConfiguredName 강제 갱신
   *       (사용자가 config 에서 이름을 변경했으니 그게 우선)
   */
  getOrCreateService(ServiceClass, displayName, subType) {
    let service = this.accessory.getServiceById(ServiceClass, subType);
    if (!service) {
      service = new ServiceClass(displayName, subType);
      this.accessory.addService(service);
    }

    service.setCharacteristic(Characteristic.Name, displayName);

    const ctx = this.accessory.context.serviceNames;
    const lastConfigName = ctx[subType];
    const configChanged = (lastConfigName !== undefined && lastConfigName !== displayName);

    if (!service.testCharacteristic(Characteristic.ConfiguredName)) {
      // 첫 생성: ConfiguredName 추가
      service.addCharacteristic(Characteristic.ConfiguredName);
      service.setCharacteristic(Characteristic.ConfiguredName, displayName);
    } else if (configChanged) {
      // config에서 이름이 변경됨: 강제 갱신 (Home 앱 변경값보다 config 우선)
      service.setCharacteristic(Characteristic.ConfiguredName, displayName);
      this.log.info(`[${this.name}] ${subType} 이름이 config에서 변경되어 갱신: ${lastConfigName} → ${displayName}`);
    }
    // configChanged=false 인 경우: 기존 ConfiguredName 그대로 두어 Home 앱 변경값 보존

    // 현재 config 이름을 기록 (다음 부팅 시 비교용, accessory.context는 자동으로 캐시에 저장됨)
    ctx[subType] = displayName;

    return service;
  }

  setupInformationService() {
    let info = this.accessory.getService(Service.AccessoryInformation);
    if (!info) {
      info = this.accessory.addService(Service.AccessoryInformation);
    }
    info
      .setCharacteristic(Characteristic.Manufacturer, 'Qingping')
      .setCharacteristic(Characteristic.Model, 'Air Monitor 2 (cgllc.airm.cgs2)')
      .setCharacteristic(Characteristic.SerialNumber, this.deviceId || (this.token ? this.token.substring(0, 16) : 'Unknown'))
      .setCharacteristic(Characteristic.FirmwareRevision, PLUGIN_VERSION);
  }

  setupAirQualityService() {
    this.airQualityService = this.getOrCreateService(Service.AirQualitySensor, this.sensorNames.airQuality, SUBTYPES.airQuality);

    this.airQualityService.getCharacteristic(Characteristic.AirQuality)
      .onGet(() => this.calcAirQuality(this.lastValues.pm25));

    this.ensureCharacteristic(this.airQualityService, Characteristic.PM2_5Density)
      .onGet(() => this.clamp(this.lastValues.pm25, 0, 1000));

    this.ensureCharacteristic(this.airQualityService, Characteristic.PM10Density)
      .onGet(() => this.clamp(this.lastValues.pm10, 0, 1000));

    this.ensureCharacteristic(this.airQualityService, Characteristic.VOCDensity)
      .onGet(() => this.clamp(this.lastValues.tvoc, 0, 5000));
  }

  setupTemperatureService() {
    this.temperatureService = this.getOrCreateService(Service.TemperatureSensor, this.sensorNames.temperature, SUBTYPES.temperature);
    this.temperatureService.getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(() => this.clamp(this.lastValues.temperature, -40, 100));
  }

  setupHumidityService() {
    this.humidityService = this.getOrCreateService(Service.HumiditySensor, this.sensorNames.humidity, SUBTYPES.humidity);
    this.humidityService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
      .onGet(() => this.clamp(this.lastValues.humidity, 0, 100));
  }

  setupCarbonDioxideService() {
    this.co2Service = this.getOrCreateService(Service.CarbonDioxideSensor, this.sensorNames.co2, SUBTYPES.co2);

    this.co2Service.getCharacteristic(Characteristic.CarbonDioxideDetected)
      .onGet(() => this.co2DetectedState
        ? Characteristic.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL
        : Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL);

    this.ensureCharacteristic(this.co2Service, Characteristic.CarbonDioxideLevel)
      .onGet(() => this.clamp(this.lastValues.co2, 0, 100000));
  }

  setupBatteryService() {
    const BatteryClass = Service.Battery || Service.BatteryService;
    this.batteryService = this.getOrCreateService(BatteryClass, this.sensorNames.battery, SUBTYPES.battery);

    this.batteryService.getCharacteristic(Characteristic.BatteryLevel)
      .onGet(() => this.clamp(this.lastValues.batteryLevel, 0, 100));

    this.batteryService.getCharacteristic(Characteristic.ChargingState)
      .onGet(() => this.mapChargingState(this.lastValues.chargingState));

    this.batteryService.getCharacteristic(Characteristic.StatusLowBattery)
      .onGet(() => this.lastValues.batteryLevel < LOW_BATTERY_THRESHOLD
        ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
        : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
  }

  ensureCharacteristic(service, charClass) {
    if (!service.testCharacteristic(charClass)) {
      service.addCharacteristic(charClass);
    }
    return service.getCharacteristic(charClass);
  }

  /*-------- 폴링 / 갱신 --------*/

  startPolling() {
    this.pollOnce();
    this.pollTimer = setInterval(() => this.pollOnce(), this.pollingIntervalMs);
  }

  async pollOnce() {
    try {
      const values = await this.monitor.readAllProperties();
      this.lastValues = { ...this.lastValues, ...values };

      this.evaluateCo2Hysteresis();
      this.pushUpdates();

      this.log.debug(`[${this.name}] 폴링 OK: T=${fmtNum(values.temperature, 1)}°C, RH=${fmtNum(values.humidity, 0)}%, PM2.5=${fmtNum(values.pm25, 0)}μg/m³, CO2=${fmtNum(values.co2, 0)}ppm (감지=${this.co2DetectedState}), Bat=${fmtNum(values.batteryLevel, 0)}%`);
    } catch (err) {
      this.log.warn(`[${this.name}] 폴링 실패: ${err.message}`);
    }
  }

  evaluateCo2Hysteresis() {
    const ppm = this.lastValues.co2;
    if (!Number.isFinite(ppm)) return;

    if (!this.co2DetectedState && ppm >= this.co2DetectThreshold) {
      this.co2DetectedState = true;
      this.log.info(`[${this.name}] CO2 감지: ${fmtNum(ppm, 0)}ppm ≥ ${this.co2DetectThreshold}ppm`);
    } else if (this.co2DetectedState && ppm <= this.co2ClearThreshold) {
      this.co2DetectedState = false;
      this.log.info(`[${this.name}] CO2 해제: ${fmtNum(ppm, 0)}ppm ≤ ${this.co2ClearThreshold}ppm`);
    }
  }

  pushUpdates() {
    try {
      const v = this.lastValues;

      if (this.airQualityService) {
        this.airQualityService.getCharacteristic(Characteristic.AirQuality)
          .updateValue(this.calcAirQuality(v.pm25));
        this.airQualityService.getCharacteristic(Characteristic.PM2_5Density)
          .updateValue(this.clamp(v.pm25, 0, 1000));
        this.airQualityService.getCharacteristic(Characteristic.PM10Density)
          .updateValue(this.clamp(v.pm10, 0, 1000));
        this.airQualityService.getCharacteristic(Characteristic.VOCDensity)
          .updateValue(this.clamp(v.tvoc, 0, 5000));
      }

      if (this.temperatureService) {
        this.temperatureService.getCharacteristic(Characteristic.CurrentTemperature)
          .updateValue(this.clamp(v.temperature, -40, 100));
      }

      if (this.humidityService) {
        this.humidityService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
          .updateValue(this.clamp(v.humidity, 0, 100));
      }

      if (this.co2Service) {
        this.co2Service.getCharacteristic(Characteristic.CarbonDioxideDetected)
          .updateValue(this.co2DetectedState
            ? Characteristic.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL
            : Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL);
        this.co2Service.getCharacteristic(Characteristic.CarbonDioxideLevel)
          .updateValue(this.clamp(v.co2, 0, 100000));
      }

      if (this.batteryService) {
        this.batteryService.getCharacteristic(Characteristic.BatteryLevel)
          .updateValue(this.clamp(v.batteryLevel, 0, 100));
        this.batteryService.getCharacteristic(Characteristic.ChargingState)
          .updateValue(this.mapChargingState(v.chargingState));
        this.batteryService.getCharacteristic(Characteristic.StatusLowBattery)
          .updateValue(v.batteryLevel < LOW_BATTERY_THRESHOLD
            ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
            : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
      }
    } catch (err) {
      this.log.debug(`[${this.name}] characteristic 업데이트 중 예외: ${err.message}`);
    }
  }

  /*-------- 변환 / 보정 --------*/

  calcAirQuality(pm25) {
    if (pm25 === undefined || pm25 === null || isNaN(pm25)) {
      return Characteristic.AirQuality.UNKNOWN;
    }
    const [a, b, c, d] = this.pm25Breakpoints;
    if (pm25 < a) return Characteristic.AirQuality.EXCELLENT;
    if (pm25 < b) return Characteristic.AirQuality.GOOD;
    if (pm25 < c) return Characteristic.AirQuality.FAIR;
    if (pm25 < d) return Characteristic.AirQuality.INFERIOR;
    return Characteristic.AirQuality.POOR;
  }

  mapChargingState(deviceValue) {
    switch (deviceValue) {
      case 1: return Characteristic.ChargingState.CHARGING;
      case 3: return Characteristic.ChargingState.NOT_CHARGEABLE;
      case 2:
      default: return Characteristic.ChargingState.NOT_CHARGING;
    }
  }

  clamp(val, min, max) {
    if (val === undefined || val === null || isNaN(val)) return min;
    if (val < min) return min;
    if (val > max) return max;
    return val;
  }
}
