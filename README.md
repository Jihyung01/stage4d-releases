# stage4d downloads

공연의 대본, 배우 동선, 3D 무대와 시간, 조명·음향 큐를 연결하는 stage4d의 공개 설치 파일 저장소입니다.

[공식 사이트](https://stage4d.com)에서 기능과 다운로드 안내를 확인할 수 있습니다.

## 0.4.0 최신 공개 체험판

- [Windows x64 설치 프로그램](https://github.com/Jihyung01/stage4d-releases/releases/download/v0.4.0/stage4d-0.4.0-win-x64-setup.exe)
- [M 시리즈 Mac](https://github.com/Jihyung01/stage4d-releases/releases/download/v0.4.0/stage4d-0.4.0-mac-arm64.dmg)
- [Intel Mac — 실행 검증 미완료](https://github.com/Jihyung01/stage4d-releases/releases/download/v0.4.0/stage4d-0.4.0-mac-x64.dmg)
- [변경 사항·설치 안내·체크섬](https://github.com/Jihyung01/stage4d-releases/releases/tag/v0.4.0)

새 작업 화면과 DXF 참조 도면, QLab 지정 큐 매핑, grandMA2 MSC 송신, MTC 미리보기 동기화를 추가했습니다. 실제 콘솔/QLab/MIDI 인터페이스 수신 동작은 미검증입니다. 영상 기반 AI 큐·동선 초안은 준비 중이며 포함되지 않습니다.

0.4.0 Apple Silicon 패키지의 실행·저장·PDF·UDP·기존 0.3.0 프로젝트/미디어 보존을 확인했습니다. Windows x64는 공개 설치판의 설치·실행·WebGL·저장·미디어·OSC/MA2 패킷·제거를 [Windows Server 2025 VM에서 통과](https://github.com/Jihyung01/stage4d-releases/actions/runs/39940163413)했습니다. 실제 Windows 10/11 GPU·오디오·콘솔 검증은 아니며 Intel 0.4.0 실행은 미검증입니다.

## 0.3.0 기존 공개 체험판

- [Windows x64 설치 프로그램](https://github.com/Jihyung01/stage4d-releases/releases/download/v0.3.0/stage4d-0.3.0-win-x64-setup.exe)
- [M 시리즈 Mac](https://github.com/Jihyung01/stage4d-releases/releases/download/v0.3.0/stage4d-0.3.0-mac-arm64.dmg)
- [Intel Mac](https://github.com/Jihyung01/stage4d-releases/releases/download/v0.3.0/stage4d-0.3.0-mac-x64.dmg)
- [설치 안내·현재 검증 범위·체크섬](https://github.com/Jihyung01/stage4d-releases/releases/tag/v0.3.0)

현재 체험판은 정식 개발자 서명·Apple 공증이 완료되지 않았습니다. 운영체제 보안 경고나 실행 차단이 있을 수 있습니다. 로컬 편집과 저장에는 로그인이 필요하지 않습니다.

## 기존 0.3.0의 실행 검증 기록 — 2026-10-23

| 대상 | 확인한 내용 |
| --- | --- |
| Windows x64 | 실제 Windows 러너에서 설치·앱 실행·재실행 저장 복원·음원/영상/PDF·프로젝트 이관·실제 UDP·제거를 확인했습니다. 실제 WebGL2 컨텍스트와 새로고침 후 복원까지 17개 검사를 통과했습니다. [Windows 검증 결과](https://github.com/Jihyung01/stage4d-releases/actions/runs/39930651890/job/120337778804) |
| M 시리즈 Mac | 공개 DMG를 내려받아 복사 설치하고, 로컬 Apple Silicon Mac에서 앱 실행·저장 복원·미디어·프로젝트 이관·UDP 검사를 통과했습니다. |
| Intel Mac | 네이티브 x64 러너에서 설치·앱 실행·저장·미디어·UDP 스모크 검사를 확인했습니다. **3D WebGL 검증은 미완료**입니다. CI에서 Electron의 소프트웨어 그래픽 초기화가 실패했으며, 실제 Intel Mac의 기본 그래픽 환경에서 확인이 필요합니다. [실패 진단 근거](https://github.com/Jihyung01/stage4d-releases/actions/runs/39931133702) |

Windows CI는 CPU 소프트웨어 렌더링(SwiftShader)을 사용합니다. 이 검증은 실제 공연장 GPU·음향 장치·조명 콘솔이나 장시간 공연의 성능을 보증하지 않습니다. [검증 방법과 범위](VALIDATION.md)를 참고하세요.

0.3.0 Google 로그인은 시스템 브라우저 인증 → 앱 복귀 → 앱 재실행 후 로그인 유지 → 로그아웃까지 확인했습니다. Apple·카카오·네이버 로그인은 아직 준비 중입니다. 로그인 없이도 로컬 공연 작업을 할 수 있습니다.

이 저장소에는 공개 설치 파일과 설치 검증 자료를 게시합니다. 프로그램 개발 소스는 별도 비공개 저장소에서 관리합니다.

문의: tbvj123wlgud@gmail.com

## Microsoft Store package

`Build Microsoft Store package` (manual workflow) downloads a published Windows x64 installer, verifies its size and SHA-256 against the release `release-info.json`, extracts the application, and builds an **unsigned** AppX with the Partner Center identity given as inputs. The Store re-signs accepted packages, so no certificate or secret is involved. The AppX is kept only as an Actions artifact for upload to Partner Center; it is not a download for users.
