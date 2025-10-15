<x-filament-panels::page>
    {{-- 로봇 생성 및 제어 섹션 --}}
    <div class="mb-6">
        <form wire:submit.prevent="">
            {{-- ✨ FIX: 폼 스키마와 함께 모든 필드 및 액션 버튼이 자동으로 렌더링됩니다. --}}
            {{ $this->form }}

            {{-- ✨ REMOVE: 이 부분은 더 이상 필요하지 않습니다. (삭제!) --}}
            {{-- <div class="mt-6 flex gap-3">
                @foreach ($this->getFormActions() as $action)
                    {{ $action }}
                @endforeach
            </div> --}}
        </form>
    </div>

    {{-- 로봇 목록 테이블 --}}
    <div>
        {{ $this->table }}
    </div>
</x-filament-panels::page>