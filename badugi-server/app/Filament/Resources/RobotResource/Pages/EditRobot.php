<?php

namespace App\Filament\Resources\RobotResource\Pages;

use App\Filament\Resources\RobotResource;
use Filament\Actions;
use Filament\Resources\Pages\EditRecord;
use Illuminate\Database\Eloquent\Model; // ✨ NEW: Model 클래스 임포트
use App\Helpers\RobotManager; // ✨ NEW: RobotManager 헬퍼 임포트


class EditRobot extends EditRecord
{
    protected static string $resource = RobotResource::class;

    protected function getHeaderActions(): array
    {
        return [
            Actions\DeleteAction::make()
                ->using(function (Model $record): void {
                    RobotManager::deleteRobot($record->email);
                }),
        ];
    }

    protected function handleRecordUpdate(Model $record, array $data): Model
    {
        // RobotManager를 사용하여 로봇을 업데이트합니다.
        RobotManager::updateRobot($record->id, $data);
        $record->fill($data); // Filament가 업데이트된 모델을 반환할 것으로 기대
        return $record;
    }
}
