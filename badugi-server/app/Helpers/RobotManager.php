<?php

namespace App\Helpers;

use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class RobotManager
{
    protected static string $filePath = 'app/robots.json'; // storage/app/robots.json 경로

    /**
     * 로봇 데이터를 파일에서 읽어옵니다.
     * @return array
     */
    public static function getRobots(): array
    {
        $path = storage_path(self::$filePath);
        if (!File::exists($path)) {
            File::put($path, json_encode([])); // 파일이 없으면 빈 배열로 생성
        }
        return json_decode(File::get($path), true);
    }

    /**
     * 로봇 데이터를 파일에 저장합니다.
     * @param array $robots
     * @return void
     */
    public static function saveRobots(array $robots): void
    {
        File::put(storage_path(self::$filePath), json_encode($robots, JSON_PRETTY_PRINT));
    }

    /**
     * 지정된 개수만큼의 로봇을 생성하고 저장합니다.
     * @param int $count
     * @param string $baseEmail
     * @param string $password
     * @return array 생성된 로봇 목록
     */
    public static function generateRobots(int $count, string $baseEmail = 'bot', string $password = 'password'): array
    {
        $existingRobots = self::getRobots();
        $newRobotsAdded = []; // 실제로 새로 추가된 로봇만 저장

        for ($i = 0; $i < $count; $i++) { // 루프 인덱스 0부터 시작
            $newId = self::generateUniqueId($existingRobots); // ✨ FIX: 매번 새로운 고유 ID 생성
            $robotEmail = "{$baseEmail}{$newId}@example.com"; // ✨ FIX: 이메일 고유성 확보 (ID와 연동)

            // 이미 존재하는 이메일인지 확인 (매우 중요)
            if (collect($existingRobots)->where('email', $robotEmail)->isNotEmpty()) {
                continue; // 이미 있는 로봇은 건너뛰기
            }

            $robot = [
                'id' => $newId,
                'name' => "로봇{$newId}",
                'email' => $robotEmail,
                'password' => Hash::make($password),
                'points' => 100000, // 기본 칩 10만
                'is_active' => false, // 초기에는 비활성
                'created_at' => now()->toDateTimeString(),
                'updated_at' => now()->toDateTimeString(),
            ];
            $newRobotsAdded[] = $robot;
            $existingRobots[] = $robot; // 전체 목록에 추가
        }

        self::saveRobots($existingRobots);
        return $newRobotsAdded; // 실제로 새로 생성된 로봇만 반환
    }

    /**
     * 로봇을 이메일로 찾아 삭제합니다.
     * @param string $email
     * @return bool
     */
    public static function deleteRobot(string $email): bool
    {
        $robots = self::getRobots();
        $initialCount = count($robots);
        $robots = collect($robots)->where('email', '!=', $email)->values()->all(); // 삭제 후 인덱스 재정렬
        self::saveRobots($robots);
        return count($robots) < $initialCount;
    }

    /**
     * 로봇을 ID로 찾아 업데이트합니다.
     * @param int $id
     * @param array $data
     * @return bool
     */
    public static function updateRobot(int $id, array $data): bool
    {
        $robots = self::getRobots();
        $updated = false;
        foreach ($robots as &$robot) {
            if ($robot['id'] === $id) {
                // 비밀번호가 'password' 필드에 있고, 비어있지 않은 경우에만 해싱하여 업데이트
                if (isset($data['password']) && filled($data['password'])) {
                    $data['password'] = Hash::make($data['password']);
                } else {
                    unset($data['password']); // 비밀번호 필드가 비어있으면 업데이트하지 않음
                }
                unset($data['password_confirmation']); // password_confirmation 필드 제거
                $robot = array_merge($robot, $data);
                $robot['updated_at'] = now()->toDateTimeString();
                $updated = true;
                break;
            }
        }
        if ($updated) {
            self::saveRobots($robots);
        }
        return $updated;
    }

    /**
     * 로봇에 대한 고유 ID를 생성합니다.
     * @param array $existingRobots
     * @return int
     */
    public static function generateUniqueId(array $existingRobots): int
    {
        $ids = collect($existingRobots)->pluck('id')->all();
        $newId = 1;
        while (in_array($newId, $ids)) {
            $newId++;
        }
        return $newId;
    }

    /**
     * 로봇을 이메일로 찾습니다.
     * @param string $email
     * @return array|null
     */
    public static function findRobotByEmail(string $email): ?array
    {
        return collect(self::getRobots())->where('email', $email)->first();
    }

    /**
     * 로봇을 ID로 찾습니다.
     * @param int $id
     * @return array|null
     */
    public static function findRobotById(int $id): ?array
    {
        return collect(self::getRobots())->where('id', $id)->first();
    }
}