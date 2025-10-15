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

class RobotControl extends Page implements Tables\Contracts\HasTable
{
    use Tables\Concerns\InteractsWithTable;
    use InteractsWithForms;

    protected static ?string $navigationIcon = 'heroicon-o-beaker';
    protected static ?string $navigationGroup = '로봇 환경';
    protected static string $view = 'filament.pages.robot-control';
    protected static ?string $title = '로봇 제어 및 관리';

    public ?array $data = [];
    public bool $showEditModal = false;
    public ?array $editingRobotData = null;
    public ?int $editingRobotId = null;

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
                ->model(\App\Models\User::class)
                ->statePath('data'),
            'editForm' => $this->makeForm()
                ->schema(static::getRobotFormSchema($this->editingRobotData, 'edit'))
                ->model(\App\Models\User::class)
                ->statePath('editingRobotData'),
        ];
    }

    public function table(Table $table): Table
    {
        return $table
            ->query(
                // ✨ FIX: 빈 쿼리 빌더를 사용하되, paginateTableQuery를 오버라이드하여 처리
                \App\Models\User::query()->whereRaw('1 = 0')
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
                    ->label('활성')
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
            ->headerActions([
                Tables\Actions\CreateAction::make()
                    ->label('새 로봇 생성')
                    ->icon('heroicon-o-plus')
                    ->form(static::getRobotFormSchema(null, 'create'))
                    ->action(function (array $data): void {
                        try {
                            $existingRobots = RobotManager::getRobots();
                            if (collect($existingRobots)->where('email', $data['email'])->isNotEmpty()) {
                                Notification::make()->title('로봇 생성 실패')->body('이미 존재하는 이메일입니다.')->danger()->send();
                                return;
                            }
                            $robotId = RobotManager::generateUniqueId($existingRobots);
                            $robotData = [
                                'id' => $robotId,
                                'name' => $data['name'],
                                'email' => $data['email'],
                                'password' => Hash::make($data['password']),
                                'points' => $data['points'],
                                'is_active' => $data['is_active'],
                                'created_at' => now()->toDateTimeString(),
                                'updated_at' => now()->toDateTimeString(),
                            ];
                            $existingRobots[] = $robotData;
                            RobotManager::saveRobots($existingRobots);

                            Notification::make()->title('로봇 생성 성공')->success()->send();
                            $this->dispatch('$refresh');
                        } catch (\Exception $e) {
                            Notification::make()->title('로봇 생성 실패')->body($e->getMessage())->danger()->send();
                        }
                    }),
            ])
            ->actions([
                Tables\Actions\EditAction::make()
                    ->label('수정')
                    ->form(fn($record): array => static::getRobotFormSchema($record->toArray(), 'edit'))
                    ->action(function (array $data, $record): void {
                        try {
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

    // ✨ FIX: paginateTableQuery 오버라이드하여 커스텀 데이터 제공
    protected function paginateTableQuery(\Illuminate\Database\Eloquent\Builder $query): \Illuminate\Contracts\Pagination\LengthAwarePaginator
    {
        $robots = collect(RobotManager::getRobots());

        // 검색 처리
        $search = $this->getTableSearch();
        if (!empty($search)) {
            $searchLower = strtolower($search);
            $robots = $robots->filter(function ($robot) use ($searchLower) {
                return Str::contains(strtolower($robot['name'] ?? ''), $searchLower) ||
                    Str::contains(strtolower($robot['email'] ?? ''), $searchLower);
            });
        }

        // 정렬 처리
        $sortColumn = $this->getTableSortColumn();
        $sortDirection = $this->getTableSortDirection();
        if ($sortColumn) {
            $robots = $robots->sortBy($sortColumn, SORT_REGULAR, $sortDirection === 'desc')->values();
        }

        // Model 객체로 변환
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

        // 페이지네이션
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
                ->description('새로운 로봇 계정을 생성합니다. 기존 로봇은 건너뛰며, 로봇 생성 후 목록에 바로 반영됩니다.')
                ->schema([
                    Forms\Components\TextInput::make('robotCountToGenerate')
                        ->numeric()
                        ->minValue(1)
                        ->maxValue(10)
                        ->default(5)
                        ->label('생성할 로봇 개수')
                        ->required(),
                ]),
            Forms\Components\Section::make('로봇 게임 제어')
                ->description('활성 상태의 로봇들을 게임에 참여시키거나 정지시킵니다.')
                ->schema([
                    Forms\Components\TextInput::make('robotCountToStart')
                        ->numeric()
                        ->minValue(1)
                        ->default(1)
                        ->label('시작할 로봇 개수 (비활성 로봇 중)')
                        ->required(),
                ]),
        ];
    }

    protected function getFormActions(): array
    {
        return [
            Actions\Action::make('generateRobots')
                ->label('로봇 생성')
                ->color('success')
                ->icon('heroicon-o-sparkles')
                ->action('generateRobotsAction')
                ->requiresConfirmation()
                ->modalHeading('로봇을 생성하시겠습니까?')
                ->modalDescription('이 작업은 기존에 없는 로봇을 추가합니다.'),
            Actions\Action::make('startRobots')
                ->label('로봇 게임 시작')
                ->color('primary')
                ->icon('heroicon-o-play')
                ->action('startRobotsAction')
                ->requiresConfirmation()
                ->modalHeading('로봇 게임을 시작하시겠습니까?')
                ->modalDescription('지정된 수의 비활성 로봇이 게임 서버에 접속합니다.'),
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

        try {
            $response = Http::withHeaders([
                'Authorization' => 'Bearer ' . $token,
            ])->post(route('api.robot-control.start'), ['count' => $this->data['robotCountToStart'] ?? 1]);

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

    public function openEditModal(int $robotId): void
    {
        $robot = RobotManager::findRobotById($robotId);
        if (!$robot) {
            Notification::make()->title('로봇을 찾을 수 없습니다.')->danger()->send();
            return;
        }
        $this->editingRobotId = $robotId;
        $this->editingRobotData = $robot;
        $this->showEditModal = true;
        $this->getForms()['editForm']->fill($this->editingRobotData);
    }

    public function closeEditModal(): void
    {
        $this->showEditModal = false;
        $this->editingRobotId = null;
        $this->editingRobotData = null;
        $this->getForms()['editForm']->fill();
    }

    public function updateRobotAction(): void
    {
        try {
            $data = $this->getForms()['editForm']->getState();

            $existingRobot = RobotManager::findRobotByEmail($data['email']);
            if ($existingRobot && $existingRobot['id'] !== $this->editingRobotId) {
                Notification::make()->title('로봇 업데이트 실패')->body('이미 존재하는 이메일입니다.')->danger()->send();
                return;
            }

            if (empty($data['password'])) {
                unset($data['password']);
            } else {
                $data['password'] = Hash::make($data['password']);
            }
            unset($data['password_confirmation']);

            RobotManager::updateRobot($this->editingRobotId, $data);
            Notification::make()->title('로봇 업데이트 성공')->success()->send();
            $this->showEditModal = false;
            $this->dispatch('$refresh');
        } catch (\Exception $e) {
            Notification::make()->title('로봇 업데이트 실패')->body($e->getMessage())->danger()->send();
        }
    }

    public function deleteRobotAction(int $robotId): void
    {
        try {
            $robot = RobotManager::findRobotById($robotId);
            if (!$robot) {
                Notification::make()->title('로봇 삭제 실패')->body('로봇을 찾을 수 없습니다.')->danger()->send();
                return;
            }
            RobotManager::deleteRobot($robot['email']);
            Notification::make()->title('로봇 삭제 성공')->success()->send();
            $this->dispatch('$refresh');
        } catch (\Exception $e) {
            Notification::make()->title('로봇 삭제 실패')->body($e->getMessage())->danger()->send();
        }
    }
}