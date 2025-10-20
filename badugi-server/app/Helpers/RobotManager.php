<?php

namespace App\Helpers;

use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use App\Models\Robot;

class RobotManager
{
    /**
     * 모든 로봇을 가져옵니다.
     * @return \Illuminate\Database\Eloquent\Collection
     */
    public static function getRobots(): \Illuminate\Database\Eloquent\Collection
    {
        return Robot::all();
    }

    /**
     * 지정된 개수만큼의 로봇을 생성하고 저장합니다.
     * @param int $count
     * @param string $baseNamePrefix - 로봇 이름의 접두사 (예: '로봇')
     * @param string $password
     * @return \Illuminate\Support\Collection 생성된 로봇 목록
     */
    public static function generateRobots(int $count, string $baseNamePrefix = '로봇', string $password = 'password'): \Illuminate\Support\Collection
    {
        $newRobotsAdded = collect();
        $existingRobotsEmails = Robot::pluck('email')->all();

        for ($i = 1; $newRobotsAdded->count() < $count; $i++) {
            $robotEmail = "bot{$i}@example.com";

            if (in_array($robotEmail, $existingRobotsEmails)) {
                continue;
            }

            $robotName = "{$baseNamePrefix}{$i}";

            $robot = Robot::create([
                'name' => $robotName,
                'email' => $robotEmail,
                'password' => Hash::make($password),
                'points' => 100000,
                'is_active' => false,
            ]);
            $newRobotsAdded->push($robot);
            $existingRobotsEmails[] = $robotEmail;
        }

        return $newRobotsAdded;
    }

    /**
     * 로봇을 이메일로 찾아 삭제합니다.
     * @param string $email
     * @return bool
     */
    public static function deleteRobot(string $email): bool
    {
        return Robot::where('email', $email)->delete();
    }

    /**
     * 로봇을 ID로 찾아 업데이트합니다.
     * @param int $id
     * @param array $data
     * @return bool
     */
    public static function updateRobot(int $id, array $data): bool
    {
        $robot = Robot::find($id);
        if (!$robot) {
            return false;
        }

        if (isset($data['password']) && filled($data['password'])) {
            $data['password'] = Hash::make($data['password']);
        } else {
            unset($data['password']);
        }
        unset($data['password_confirmation']);

        return $robot->update($data);
    }

    /**
     * 로봇을 이메일로 찾습니다.
     * @param string $email
     * @return \App\Models\Robot|null
     */
    public static function findRobotByEmail(string $email): ?Robot
    {
        return Robot::where('email', $email)->first();
    }

    /**
     * 로봇을 ID로 찾습니다.
     * @param int $id
     * @return \App\Models\Robot|null
     */
    public static function findRobotById(int $id): ?Robot
    {
        return Robot::find($id);
    }
}
