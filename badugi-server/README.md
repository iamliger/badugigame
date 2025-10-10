##트리구조 보기
```bash
badugi-game-server/
├── node_modules/
├── src/
│   ├── app.js             // 메인 애플리케이션 진입점 (Express 및 Socket.IO 설정)
│   ├── server.js          // 서버 시작 로직
│   ├── config/            // 환경 설정 파일 (포트, 데이터베이스 연결 정보 등)
│   │   └── index.js
│   ├── models/            // 게임 관련 데이터 모델 (Room, Player, Card 등)
│   │   ├── Room.js
│   │   └── Player.js
│   ├── services/          // 게임 로직 및 비즈니스 로직 (카드 딜링, 베팅 처리, 족보 판정 등)
│   │   ├── GameService.js
│   │   └── CardService.js
│   ├── handlers/          // Socket.IO 이벤트 핸들러
│   │   ├── roomHandler.js
│   │   └── gameHandler.js
│   ├── utils/             // 유틸리티 함수 (난수 생성, 헬퍼 함수 등)
│   │   └── constants.js
│   └── routes/            // (선택적) Laravel 백엔드와 통신할 REST API (예: 게임 종료 후 결과 업데이트)
│       └── api.js
├── public/                // (선택적) 정적 파일 제공
├── .env                   // 환경 변수 파일
├── package.json           // 프로젝트 정보 및 의존성 관리
└── package-lock.json
```

