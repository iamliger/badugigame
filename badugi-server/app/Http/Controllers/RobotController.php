<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use App\Helpers\RobotManager;
use Illuminate\Support\Facades\Log;

class RobotController extends Controller
{
    protected string $gameServerUrl;
    protected string $gameServerApiSecret;

    public function __construct()
    {
        $this->gameServerUrl = env('GAME_SERVER_URL', 'http://localhost:3000');
        $this->gameServerApiSecret = env('GAME_SERVER_API_SECRET', 'your_game_server_api_secret');
    }

    /**
     * Node.js 게임 서버에 로봇 시작 명령을 보냅니다.
     * @param Request $request
     * @return \Illuminate\Http\JsonResponse
     */
    public function startRobots(Request $request)
    {
        // ✨ FIX: Filament에서 직접 비활성 로봇 목록을 받아 처리
        $robotsToStart = $request->input('robots', []);

        if (empty($robotsToStart)) {
            return response()->json(['message' => '시작할 로봇 정보가 없습니다.'], 400);
        }

        try {
            // Node.js 게임 서버로 HTTP 요청 전송
            $response = Http::withHeaders([
                'X-Game-Server-API-Secret' => $this->gameServerApiSecret, // 보안 헤더
            ])->post("{$this->gameServerUrl}/api/robot-commands/start", [
                'robots' => $robotsToStart, // 라라벨에서 이미 필터링된 로봇 정보 전달
            ]);

            if ($response->successful()) {
                // 로봇의 is_active 상태를 true로 업데이트 (게임 서버에서 성공적으로 시작했다면)
                foreach ($robotsToStart as $robotData) {
                    RobotManager::updateRobot($robotData['id'], ['is_active' => true]);
                }
                Log::info("로봇 시작 명령 성공: {$response->body()}");
                return response()->json(['message' => '로봇 시작 명령 성공', 'response' => $response->json()]);
            } else {
                Log::error("로봇 시작 명령 실패: {$response->status()} - {$response->body()}");
                return response()->json(['message' => '로봇 시작 명령 실패', 'error' => $response->body()], $response->status());
            }
        } catch (\Exception $e) {
            Log::error("로봇 시작 명령 중 예외 발생: {$e->getMessage()}");
            return response()->json(['message' => '서버 오류 발생', 'error' => $e->getMessage()], 500);
        }
    }

    /**
     * Node.js 게임 서버에 로봇 정지 명령을 보냅니다.
     * @param Request $request
     * @return \Illuminate\Http\JsonResponse
     */
    public function stopRobots(Request $request)
    {
        $robotIds = $request->input('robotIds', []); // 정지할 특정 로봇 ID 목록 (비어있으면 전체 정지)
        // ✨ FIX: 정지할 로봇 목록을 RobotManager에서 가져와서 전달
        $robotsToStop = collect(RobotManager::getRobots())
            ->whereIn('id', $robotIds) // 특정 ID만 정지
            ->where('is_active', true) // 활성 상태인 로봇만
            ->values()
            ->all();

        // robotIds가 비어있으면 모든 활성 로봇 정지
        if (empty($robotIds)) {
            $robotsToStop = collect(RobotManager::getRobots())->where('is_active', true)->values()->all();
        }


        if (empty($robotsToStop)) {
            return response()->json(['message' => '정지할 활성 로봇이 없습니다.'], 400);
        }

        try {
            $response = Http::withHeaders([
                'X-Game-Server-API-Secret' => $this->gameServerApiSecret,
            ])->post("{$this->gameServerUrl}/api/robot-commands/stop", [
                'robotIds' => collect($robotsToStop)->pluck('id')->all(),
            ]);

            if ($response->successful()) {
                // 로봇의 is_active 상태를 false로 업데이트
                foreach ($robotsToStop as $robotData) {
                    RobotManager::updateRobot($robotData['id'], ['is_active' => false]);
                }
                Log::info("로봇 정지 명령 성공: {$response->body()}");
                return response()->json(['message' => '로봇 정지 명령 성공', 'response' => $response->json()]);
            } else {
                Log::error("로봇 정지 명령 실패: {$response->status()} - {$response->body()}");
                return response()->json(['message' => '로봇 정지 명령 실패', 'error' => $response->body()], $response->status());
            }
        } catch (\Exception $e) {
            Log::error("로봇 정지 명령 중 예외 발생: {$e->getMessage()}");
            return response()->json(['message' => '서버 오류 발생', 'error' => $e->getMessage()], 500);
        }
    }
}