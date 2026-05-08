<span align="center">

# homebridge-qingping-air-monitor2

[![npm](https://badgen.net/npm/v/homebridge-qingping-air-monitor2?icon=npm)](https://www.npmjs.com/package/homebridge-qingping-air-monitor2)
[![mit-license](https://badgen.net/badge/license/MIT/blue)](https://github.com/Km81/homebridge-qingping-air-monitor2/blob/master/LICENSE)

</span>

> Qingping Air Monitor 2 (`cgllc.airm.cgs2`) 전용 Homebridge 플러그인입니다. **Homebridge 2.0** 환경에서 동작하도록 설계되었으며, miot 프로토콜 통신부는 [merdok/homebridge-miot](https://github.com/merdok/homebridge-miot)의 `MiioProtocol.js`를 차용했습니다 (MIT 라이선스).

## 특징

- 단일 모델 전용으로 가볍고 빠릅니다 (외부 npm 의존성 없음)
- HomeKit에 다음 센서를 등록합니다 (각각 독립적으로 켜고 끌 수 있음):
  - **공기질 센서** (PM2.5, PM10, VOC + 종합 등급)
  - **온도 센서**
  - **습도 센서**
  - **이산화탄소(CO2) 센서**
  - **배터리** (잔량 + 충전 상태) — 항상 활성
- 공기질 등급 경계값을 사용자가 직접 설정 가능
- CO2 감지 임계값에 **히스테리시스(hysteresis)** 적용 — 깜빡임 없는 안정적 감지
- iOS Home 앱에서 변경한 서브 액세서리 이름이 **재부팅 후에도 유지됩니다**
- Xiaomi 클라우드 로그인이나 토큰 추출 기능은 포함하지 않습니다 — 토큰은 별도 도구로 추출해서 입력하면 됩니다

## 설치

Homebridge UI에서 플러그인 검색으로 `homebridge-qingping-air-monitor2`를 찾아 설치하거나, 터미널에서:

```sh
sudo npm install -g homebridge-qingping-air-monitor2
```

> **요구 환경**: Node.js 18.15+, Homebridge 2.0+

## 토큰 얻기

이 플러그인은 의도적으로 토큰 추출 기능을 포함하지 않습니다. 다음 도구를 사용하세요:

- [Xiaomi Cloud Tokens Extractor](https://github.com/PiotrMachowski/Xiaomi-cloud-tokens-extractor) (가장 간단)
- 기존에 [merdok/homebridge-miot](https://github.com/merdok/homebridge-miot)을 사용 중이라면, 거기서 추출한 토큰을 그대로 옮겨오면 됩니다
- [Mi 디바이스 토큰 가이드](https://github.com/jghaanstra/com.xiaomi-miio/blob/master/docs/obtain_token.md)

## 설정

`config.json`의 `platforms` 배열에 다음을 추가합니다:

```json
{
  "platforms": [
    {
      "platform": "QingpingAirMonitor2",
      "devices": [
        {
          "name": "거실 공기질 모니터",
          "ip": "192.168.0.123",
          "token": "abcdef0123456789abcdef0123456789",
          "deviceId": "123456789",
          "pollingInterval": 30,

          "enableAirQualitySensor": true,
          "enableTemperatureSensor": true,
          "enableHumiditySensor": true,
          "enableCarbonDioxideSensor": true,

          "pm25Breakpoints": [15, 35, 75, 150],

          "co2DetectThreshold": 1000,
          "co2ClearThreshold": 900
        }
      ]
    }
  ]
}
```

### 설정 항목

#### 기본

| 항목 | 필수 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `name` | 필수 | `Qingping Air Monitor 2` | HomeKit에 표시될 이름 |
| `ip` | 필수 | — | 장치의 IP 주소 |
| `token` | 필수 | — | miot 통신 토큰 (32자 16진수) |
| `deviceId` | 선택 | — | miot device id. 자동 감지되지만 안 될 경우 수동 입력 |
| `pollingInterval` | 선택 | `30` | 장치 폴링 주기(초). 5~600 범위 |

#### 센서 활성화 토글

각 센서를 독립적으로 켜고 끌 수 있습니다. **`false`로 설정하면 해당 서비스가 액세서리에서 제거**되고 Home 앱에서도 사라집니다.

| 항목 | 기본값 | 설명 |
| --- | --- | --- |
| `enableAirQualitySensor` | `true` | 공기질 센서 (PM2.5/PM10/VOC + 종합 등급) |
| `enableTemperatureSensor` | `true` | 온도 센서 |
| `enableHumiditySensor` | `true` | 습도 센서 |
| `enableCarbonDioxideSensor` | `true` | 이산화탄소(CO2) 센서 |

> 배터리 서비스는 항상 활성화됩니다.

#### 공기질 등급 경계값

`pm25Breakpoints`는 PM2.5 농도(μg/m³)로 공기질 등급을 5단계로 나누는 **4개 경계값**입니다. 작은 값부터 큰 값 순서로 입력하세요.

`pm25Breakpoints = [a, b, c, d]` 일 때:

| PM2.5 농도 (μg/m³) | HomeKit 등급 |
| --- | --- |
| `< a` | EXCELLENT (매우 좋음) |
| `a ~ b` | GOOD (좋음) |
| `b ~ c` | FAIR (보통) |
| `c ~ d` | INFERIOR (나쁨) |
| `≥ d` | POOR (매우 나쁨) |

**참고 기준값**:

| 기준 | 매우좋음 | 좋음 | 보통 | 나쁨 | 매우나쁨 | 권장 입력값 |
| --- | --- | --- | --- | --- | --- | --- |
| WHO 가이드라인 (엄격) | <7 | 7~15 | 15~30 | 30~55 | ≥55 | `[7, 15, 30, 55]` (기본값) |
| 한국 환경부 (4단계 + 세분화) | <15 | 15~35 | 35~75 | 75~150 | ≥150 | `[15, 35, 75, 150]` |
| 미국 EPA (AQI 기반 근사) | <12 | 12~35 | 35~55 | 55~150 | ≥150 | `[12, 35, 55, 150]` |

#### CO2 히스테리시스 임계값

CO2 감지 상태가 임계값 부근에서 깜빡이는 것을 막기 위해, 감지/해제 임계값을 분리해서 설정합니다:

| 항목 | 기본값 | 설명 |
| --- | --- | --- |
| `co2DetectThreshold` | `1000` | CO2 농도가 이 값 **이상**이면 'CO2 비정상' 상태로 전환 |
| `co2ClearThreshold` | `900` | 감지 상태에서 이 값 **이하**로 내려가야 '정상' 상태로 복귀 |

**동작 예시** (`co2DetectThreshold=1000`, `co2ClearThreshold=900`):

```
정상   → 850ppm → 정상   (변화 없음)
정상   → 950ppm → 정상   (1000 미만이라 감지 안 됨)
정상   → 1050ppm → 감지!  (1000 이상)
감지   → 950ppm → 감지   (900 초과라 해제 안 됨)
감지   → 880ppm → 정상   (900 이하)
```

> ⚠️ `co2ClearThreshold` 는 반드시 `co2DetectThreshold` 보다 작아야 합니다. 그렇지 않으면 플러그인이 경고하고 기본값(1000/900)으로 자동 보정합니다.
>
> **권장 차이**: 50~150ppm 정도 (너무 가까우면 깜빡임, 너무 멀면 해제가 늦어짐)

## 서브 액세서리 이름 변경 후 보존

이 플러그인은 다음 두 가지 패턴으로 사용자가 변경한 이름을 영구 보존합니다:

1. **Homebridge 캐시 액세서리 재사용** — 재부팅 시 액세서리를 새로 만들지 않고 캐시에서 복원
2. **`Characteristic.ConfiguredName` 추가** — 각 서비스에 추가하되 초기값은 처음 한 번만 설정

이 덕분에 Home 앱에서 "온도" → "거실 온도", "공기질" → "거실 공기질" 등으로 바꿔두면 Homebridge 컨테이너를 재시작해도 변경값이 그대로 남습니다.

## 변경 이력

### 1.1.0
- 센서별 활성화/비활성화 토글 4종 추가 (`enableAirQualitySensor`, `enableTemperatureSensor`, `enableHumiditySensor`, `enableCarbonDioxideSensor`)
- CO2 감지에 히스테리시스 적용 (`co2DetectThreshold` + `co2ClearThreshold`)
- 비활성화된 서비스가 캐시 액세서리에서 자동으로 제거됨
- 구버전 옵션 `co2AbnormalThreshold`는 deprecated (자동으로 `co2DetectThreshold`로 변환됨)

### 1.0.0
- 최초 배포

## 문제 해결

플러그인이나 장치 동작에 문제가 있다면 Homebridge를 디버그 모드로 실행해 더 자세한 로그를 확인하세요:

```sh
homebridge -D
```

자주 발생하는 문제:

- **`Could not connect to device, handshake timeout`** — IP가 잘못되었거나 장치가 네트워크에 없음. 또는 토큰이 잘못됨.
- **`Invalid packet, checksum was ... should be ...`** — 토큰이 틀림. 다시 추출하세요.
- **센서값이 모두 0** — 장치는 연결되었으나 응답이 비어있음. 충전 케이블을 연결한 상태에서 다시 시도.

## 알려진 제한

- **소음(데시벨) 측정값**은 노출하지 않습니다. HomeKit에 표준 노이즈 센서 서비스가 없기 때문입니다.
- 장치의 **알람/시계 설정**은 다루지 않습니다. 이 플러그인은 센서값 모니터링에만 집중합니다.

## 감사의 말

- [merdok / Marcin](https://github.com/merdok) — 본 플러그인의 miot 프로토콜 통신부(`MiioProtocol.js`)는 원작자의 [homebridge-miot](https://github.com/merdok/homebridge-miot)에서 차용했습니다. 원작자의 노력에 깊이 감사드립니다.
- [Homebridge](https://homebridge.io/) 프로젝트
- [Sensirion](https://sensirion.com/) — VOC index → 농도 변환 가이드라인 제공

## 라이선스

MIT
