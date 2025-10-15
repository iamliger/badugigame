<?php

namespace App\Filament\Pages;

use App\Helpers\RobotManager;
use Filament\Actions;
use Filament\Forms;
use Filament\Forms\Form;
use Filament\Notifications\Notification;
use Filament\Pages\Page;
use Filament\Tables;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Filament\Forms\Concerns\InteractsWithForms;
use Filament\Tables\Concerns\InteractsWithTable;

class RobotControl extends Page implements Tables\Contracts\HasTable
{
    use InteractsWithTable;
    use InteractsWithForms;

    protected static ?string $navigationIcon = 'heroicon-o-beaker';
    protected static ?string $navigationGroup = '로봇 환경';
    protected static string $view = 'filament.pages.robot-control';
    protected static ?string $title = '로봇 제어 및 관리';

    public ?array $data = []; // 폼 필드 값을 바인딩할 속성

    public function mount(): void
    {
        $this->form->fill();
        $this->fill(['data' => ['robotCountToGenerate' => 5, 'robotCountToStart' => 1]]);
    }

    protected function getForms(): array
    {
        return [
            'form' => $this->makeForm()
                ->schema($this->getFormSchema())
                ->statePath('data'),
        ];
    }

    // ✨ NEW: 페이지 레벨의 액션 버튼들을 정의하는 메서드
    protected function getActions(): array
    {
        return [
            Actions\Action::make('generateRobots')
                ->label('로봇 계정 생성')
                ->color('success')
                ->icon('heroicon-o-sparkles')
                ->action('generateRobotsAction')
                ->requiresConfirmation()
                ->modalHeading('로봇 계정을 생성하시겠습니까?')
                ->modalDescription('이 작업은 지정된 개수만큼의 새로운 로봇 계정을 생성합니다. 이미 존재하는 이메일은 건너뜁니다.')
                ->modalSubmitActionLabel('생성'),
            Actions\Action::make('startRobots')
                ->label('로봇 게임 시작')
                ->color('primary')
                ->icon('heroicon-o-play')
                ->action('startRobotsAction')
                ->requiresConfirmation()
                ->modalHeading('로봇 게임을 시작하시겠습니까?')
                ->modalDescription('지정된 수의 비활성 로봇이 게임 서버에 접속하여 게임에 참여합니다.')
                ->modalSubmitActionLabel('시작'),
            Actions\Action::make('stopAllRobots')
                ->label('모든 로봇 게임 정지')
                ->color('danger')
                ->icon('heroicon-o-stop')
                ->action('stopRobotsAction')
                ->requiresConfirmation()
                ->modalHeading('모든 로봇을 정지하시겠습니까?')
                ->modalDescription('이 작업은 되돌릴 수 없습니다. 모든 활성 로봇이 게임에서 퇴장합니다.')
                ->modalSubmitActionLabel('정지'),
        ];
    }

    public function table(Table $table): Table
    {
        return $table
            ->query(
                \App\Models\User::query()->whereRaw('1 = 0') // 더미 쿼리
            )
            ->columns([
                Tables\Columns\TextColumn::make('id')
                    ->label('ID')
                    ->sortable(),
                Tables\Columns\TextColumn::make('name')
                    ->label('이름')
                    ->sortable()
                    ->searchable(),
                Tables\Columns\TextColumn::make('email')
                    ->label('이메일')
                    ->sortable()
                    ->searchable(),
                Tables\Columns\TextColumn::make('points')
                    ->label('보유 칩')
                    ->numeric()
                    ->sortable(),
                Tables\Columns\IconColumn::make('is_active')
                    ->label('활성 여부')
                    ->boolean()
                    ->sortable(),
                Tables\Columns\TextColumn::make('created_at')
                    ->label('생성일')
                    ->dateTime()
                    ->sortable(),
                Tables\Columns\TextColumn::make('updated_at')
                    ->label('최종 수정일')
                    ->dateTime()
                    ->sortable(),
            ])
            ->filters([])
            ->headerActions([]) // 헤더 액션 제거 (이미지상 '새 로봇 생성' 버튼이 여기에 해당했음)
            ->actions([
                Tables\Actions\ActionGroup::make([
                    Tables\Actions\EditAction::make()
                        ->label('수정')
                        ->form(fn($record): array => static::getRobotFormSchema($record->toArray(), 'edit'))
                        ->action(function (array $data, $record): void {
                            try {
                                if (isset($data['password']) && filled($data['password'])) {
                                    $data['password'] = Hash::make($data['password']);
                                } else {
                                    unset($data['password']);
                                }
                                unset($data['password_confirmation']);
                                RobotManager::updateRobot($record->id, $data);
                                Notification::make()->title('로봇 업데이트 성공')->success()->send();
                                $this->dispatch('$refresh');
                            } catch (\Exception $e) {
                                Notification::make()->title('로봇 업데이트 실패')->body($e->getMessage())->danger()->send();
                            }
                        }),
                    Tables\Actions\DeleteAction::make()
                        ->label('삭제')
                        ->action(function ($record): void {
                            try {
                                RobotManager::deleteRobot($record->email);
                                Notification::make()->title('로봇 삭제 성공')->success()->send();
                                $this->dispatch('$refresh');
                            } catch (\Exception | \Throwable $e) {
                                Notification::make()->title('로봇 삭제 실패')->body($e->getMessage())->danger()->send();
                            }
                        }),
                ])
            ])
            ->bulkActions([
                Tables\Actions\BulkActionGroup::make([
                    Tables\Actions\DeleteBulkAction::make()
                        ->action(function (Collection $records): void {
                            foreach ($records as $record) {
                                RobotManager::deleteRobot($record->email);
                            }
                            Notification::make()->title('선택된 로봇 삭제 성공')->success()->send();
                            $this->dispatch('$refresh');
                        }),
                ]),
            ])
            ->defaultSort('id', 'asc')
            ->paginated([10, 25, 50, 'all']);
    }

    protected function paginateTableQuery(\Illuminate\Database\Eloquent\Builder $query): \Illuminate\Contracts\Pagination\LengthAwarePaginator
    {
        $robots = collect(RobotManager::getRobots());
        $search = $this->getTableSearch();
        if (!empty($search)) {
            $searchLower = strtolower($search);
            $robots = $robots->filter(function ($robot) use ($searchLower) {
                return Str::contains(strtolower($robot['name'] ?? ''), $searchLower) ||
                    Str::contains(strtolower($robot['email'] ?? ''), $searchLower);
            });
        }
        $sortColumn = $this->getTableSortColumn();
        $sortDirection = $this->getTableSortDirection();
        if ($sortColumn) {
            $robots = $robots->sortBy($sortColumn, SORT_REGULAR, $sortDirection === 'desc')->values();
        }
        $models = $robots->map(function ($robotData) {
            $model = new class extends Model {
                protected $guarded = [];
                public $exists = true;
                public function getKey()
                {
                    return $this->id;
                }
            };
            $model->fill($robotData);
            return $model;
        });
        $page = $this->getTablePage();
        $perPage = $this->getTableRecordsPerPage();
        if ($perPage === 'all') {
            $perPage = $models->count();
        }
        return new \Illuminate\Pagination\LengthAwarePaginator(
            $models->forPage($page, $perPage),
            $models->count(),
            $perPage,
            $page,
            ['path' => request()->url()]
        );
    }

    public static function getRobotFormSchema(?array $robotData = null, string $operation = 'create'): array
    {
        return [
            Forms\Components\TextInput::make('name')
                ->required()
                ->maxLength(255)
                ->label('로봇 이름')
                ->default($robotData['name'] ?? null),
            Forms\Components\TextInput::make('email')
                ->email()
                ->required()
                ->maxLength(255)
                ->label('이메일')
                ->default($robotData['email'] ?? null)
                ->rules([
                    'required',
                    'email',
                    'max:255',
                    function ($attribute, $value, $fail) use ($robotData, $operation) {
                        $existingRobot = RobotManager::findRobotByEmail($value);
                        if ($existingRobot && ($operation === 'create' || ($robotData && $existingRobot['id'] !== $robotData['id']))) {
                            $fail('이미 존재하는 로봇 이메일입니다.');
                        }
                    },
                ]),
            Forms\Components\TextInput::make('password')
                ->password()
                ->dehydrateStateUsing(fn(string $state): string => Hash::make($state))
                ->dehydrated(fn(?string $state): bool => filled($state))
                ->required(fn(): bool => $operation === 'create')
                ->confirmed()
                ->label('비밀번호'),
            Forms\Components\TextInput::make('password_confirmation')
                ->password()
                ->required(fn(): bool => $operation === 'create')
                ->label('비밀번호 확인'),
            Forms\Components\TextInput::make('points')
                ->numeric()
                ->required()
                ->default(100000)
                ->label('보유 칩')
                ->default($robotData['points'] ?? 100000),
            Forms\Components\Toggle::make('is_active')
                ->label('활성 여부')
                ->default(false)
                ->default($robotData['is_active'] ?? false),
        ];
    }

    protected function getFormSchema(): array
    {
        return [
            Forms\Components\Section::make('로봇 생성')
                ->description('지정된 개수만큼의 로봇 계정을 생성합니다. 기존에 존재하는 이메일의 로봇은 건너뛰며, 생성 후 아래 목록에 바로 반영됩니다.')
                ->schema([
                    Forms\Components\TextInput::make('robotCountToGenerate')
                        ->numeric()
                        ->minValue(1)
                        ->maxValue(100)
                        ->default(5)
                        ->label('생성할 로봇 개수')
                        ->required(),
                ]),
            Forms\Components\Section::make('로봇 게임 제어')
                ->description('활성 상태의 로봇들을 게임에 참여시키거나 정지시킵니다. "활성 여부"가 true인 로봇만 시작 가능합니다.')
                ->schema([
                    Forms\Components\TextInput::make('robotCountToStart')
                        ->numeric()
                        ->minValue(1)
                        ->default(1)
                        ->label('시작할 로봇 개수 (현재 비활성 로봇 중)')
                        ->required(),
                ]),
        ];
    }

    // ✨ NEW: 페이지 레벨의 액션 버튼들을 정의하는 메서드 (기존 getFormActions 이름 변경)
    // 이 메서드에서 반환되는 액션들은 Blade 템플릿의 `$this->getActions()`에 의해 렌더링됩니다.
    protected function getHeaderActions(): array
    {
        return [
            Actions\Action::make('generateRobots')
                ->label('로봇 계정 생성')
                ->color('success')
                ->icon('heroicon-o-sparkles')
                ->action('generateRobotsAction')
                ->requiresConfirmation()
                ->modalHeading('로봇 계정을 생성하시겠습니까?')
                ->modalDescription('이 작업은 지정된 개수만큼의 새로운 로봇 계정을 생성합니다. 이미 존재하는 이메일은 건너뜁니다.')
                ->modalSubmitActionLabel('생성'),
            Actions\Action::make('startRobots')
                ->label('로봇 게임 시작')
                ->color('primary')
                ->icon('heroicon-o-play')
                ->action('startRobotsAction')
                ->requiresConfirmation()
                ->modalHeading('로봇 게임을 시작하시겠습니까?')
                ->modalDescription('지정된 수의 비활성 로봇이 게임 서버에 접속하여 게임에 참여합니다.')
                ->modalSubmitActionLabel('시작'),
            Actions\Action::make('stopAllRobots')
                ->label('모든 로봇 게임 정지')
                ->color('danger')
                ->icon('heroicon-o-stop')
                ->action('stopRobotsAction')
                ->requiresConfirmation()
                ->modalHeading('모든 로봇을 정지하시겠습니까?')
                ->modalDescription('이 작업은 되돌릴 수 없습니다. 모든 활성 로봇이 게임에서 퇴장합니다.')
                ->modalSubmitActionLabel('정지'),
        ];
    }


    public function generateRobotsAction(): void
    {
        $count = $this->data['robotCountToGenerate'] ?? 0;
        if ($count <= 0) {
            Notification::make()->title('생성할 로봇 개수를 입력해주세요.')->danger()->send();
            return;
        }

        try {
            $newRobots = RobotManager::generateRobots($count, 'bot', 'password');
            Notification::make()->title(count($newRobots) . '개의 로봇이 생성(또는 스킵)되었습니다.')->success()->send();
            $this->dispatch('$refresh');
        } catch (\Exception $e) {
            Notification::make()->title('로봇 생성 실패')->body($e->getMessage())->danger()->send();
        }
    }

    public function startRobotsAction(): void
    {
        /** @var \App\Models\User|null $user */
        $user = Auth::user();
        if (!$user instanceof \App\Models\User) {
            Notification::make()->title('인증된 사용자 정보를 찾을 수 없습니다.')->danger()->send();
            return;
        }

        $token = $user->createToken('robot-control-start', ['robot:control'])->plainTextToken;
        $robotCountToStart = $this->data['robotCountToStart'] ?? 1;

        $inactiveRobots = collect(RobotManager::getRobots())
            ->where('is_active', false)
            ->take($robotCountToStart)
            ->values()
            ->all();

        if (empty($inactiveRobots)) {
            Notification::make()->title('로봇 시작 실패')->body('시작할 비활성 로봇이 없습니다.')->danger()->send();
            return;
        }

        try {
            $response = Http::withHeaders([
                'Authorization' => 'Bearer ' . $token,
            ])->post(route('api.robot-control.start'), ['robots' => $inactiveRobots]);

            if ($response->successful()) {
                Notification::make()->title('로봇 시작 명령 성공')->body($response->json('message'))->success()->send();
                $this->dispatch('$refresh');
            } else {
                Notification::make()->title('로봇 시작 명령 실패')->body($response->json('message') ?: $response->body())->danger()->send();
            }
        } catch (\Exception $e) {
            Log::error("Filament 로봇 시작 액션 중 예외 발생: {$e->getMessage()}");
            Notification::make()->title('로봇 시작 실패')->body($e->getMessage())->danger()->send();
        }
    }

    public function stopRobotsAction(): void
    {
        /** @var \App\Models\User|null $user */
        $user = Auth::user();
        if (!$user instanceof \App\Models\User) {
            Notification::make()->title('인증된 사용자 정보를 찾을 수 없습니다.')->danger()->send();
            return;
        }

        $token = $user->createToken('robot-control-stop', ['robot:control'])->plainTextToken;

        try {
            $response = Http::withHeaders([
                'Authorization' => 'Bearer ' . $token,
            ])->post(route('api.robot-control.stop'));

            if ($response->successful()) {
                Notification::make()->title('모든 로봇 정지 명령 성공')->body($response->json('message'))->success()->send();
                $this->dispatch('$refresh');
            } else {
                Notification::make()->title('모든 로봇 정지 명령 실패')->body($response->json('message') ?: $response->body())->danger()->send();
            }
        } catch (\Exception $e) {
            Log::error("Filament 로봇 정지 액션 중 예외 발생: {$e->getMessage()}");
            Notification::make()->title('로봇 정지 실패')->body($e->getMessage())->danger()->send();
        }
    }
}