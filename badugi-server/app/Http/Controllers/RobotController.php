<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use App\Models\Robot; // ✨ NEW: Robot 모델 임포트
use Illuminate\Support\Facades\Log;

class RobotController extends Controller
{
    protected string $gameServerUrl;
    protected string $gameServerApiSecret;

    public function __construct()
    {
        $this->gameServerUrl = env('GAME_SERVER_URL', 'http://localhost:3000');
        $this->gameServerApiSecret = config('services.game_server.api_secret');

        if (empty($this->gameServerApiSecret) || $this->gameServerApiSecret === 'your_game_server_api_secret') {
            Log::warning('GAME_SERVER_API_SECRET이 설정되지 않았거나 기본값입니다. .env 및 config/services.php를 확인해주세요.');
        }
    }

    /**
     * Node.js 게임 서버에 로봇 시작 명령을 보냅니다.
     * @param Request $request
     * @return \Illuminate\Http\JsonResponse
     */
    public function startRobots(Request $request)
    {
        $robotsToStart = $request->input('robots', []);

        if (empty($robotsToStart)) {
            return response()->json(['message' => '시작할 로봇 정보가 없습니다.'], 400);
        }

        try {
            $response = Http::withHeaders([
                'X-Game-Server-API-Secret' => $this->gameServerApiSecret,
            ])->post("{$this->gameServerUrl}/api/robot-commands/start", [
                'robots' => $robotsToStart,
            ]);

            if ($response->successful()) {
                foreach ($robotsToStart as $robotData) {
                    $robot = Robot::find($robotData['id']);
                    if ($robot) {
                        $robot->update(['is_active' => true]);
                    }
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
        $robotIds = $request->input('robotIds', []);

        if (empty($robotIds)) {
            $robotsToStop = Robot::where('is_active', true)->get();
        } else {
            $robotsToStop = Robot::whereIn('id', $robotIds)->where('is_active', true)->get();
        }

        if ($robotsToStop->isEmpty()) {
            return response()->json(['message' => '정지할 활성 로봇이 없습니다.'], 400);
        }

        try {
            $response = Http::withHeaders([
                'X-Game-Server-API-Secret' => $this->gameServerApiSecret,
            ])->post("{$this->gameServerUrl}/api/robot-commands/stop", [
                'robotIds' => $robotsToStop->pluck('id')->all(),
            ]);

            if ($response->successful()) {
                $robotsToStop->each(function (Robot $robot) {
                    $robot->update(['is_active' => false]);
                });
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