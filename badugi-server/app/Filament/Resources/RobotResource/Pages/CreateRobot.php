<?php

namespace App\Filament\Resources\RobotResource\Pages;

use App\Filament\Resources\RobotResource;
use Filament\Actions;
use Filament\Resources\Pages\CreateRecord;
use Illuminate\Database\Eloquent\Model; // ✨ NEW: Model 클래스 임포트


class CreateRobot extends CreateRecord
{
    protected static string $resource = RobotResource::class;

    protected function handleRecordCreation(array $data): Model
    {
        // RobotResource의 static createRobotEntry 메서드를 사용하여 로봇을 생성합니다.
        // Filament가 Model 객체를 반환할 것을 기대하므로, 생성된 로봇 데이터를 Model로 래핑합니다.
        $newRobot = RobotResource::createRobotEntry($data);
        return new Model((array)$newRobot);
    }
}
