<?php

namespace App\Filament\Resources\RobotResource\Pages;

use App\Filament\Resources\RobotResource;
use App\Helpers\RobotManager;
use Filament\Actions;
use Filament\Resources\Pages\ListRecords;
use Filament\Tables\Table;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;
use Illuminate\Database\Eloquent\Model;

class ListRobots extends ListRecords
{
    protected static string $resource = RobotResource::class;

    /**
     * 상단 버튼 (+Create)
     */
    protected function getHeaderActions(): array
    {
        return [
            Actions\CreateAction::make(),
        ];
    }
}