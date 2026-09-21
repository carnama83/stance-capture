import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Filter, X } from 'lucide-react';
import { useTranslation } from "react-i18next";

interface FilterState {
  tags: string[];
  regions: string[];
  state: string[];
  showAnswered: boolean;
}

interface FeedFiltersProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
}

export function FeedFilters({ filters, onChange }: FeedFiltersProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  const availableTags = [
    'Politics', 'Environment', 'Economy', 'Healthcare', 
    'Education', 'Technology', 'Social Issues'
  ];

  const availableStates = [
    { value: 'active', label: t("feedFilters.active") },
    { value: 'cooling', label: t("feedFilters.cooling") },
    { value: 'dormant', label: t("feedFilters.dormant") },
  ];

  const toggleTag = (tag: string) => {
    onChange({
      ...filters,
      tags: filters.tags.includes(tag)
        ? filters.tags.filter(t => t !== tag)
        : [...filters.tags, tag],
    });
  };

  const clearFilters = () => {
    onChange({
      tags: [],
      regions: [],
      state: [],
      showAnswered: false,
    });
  };

  const activeFilterCount = 
    filters.tags.length + 
    filters.regions.length + 
    filters.state.length +
    (filters.showAnswered ? 0 : 1);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <Filter className="h-4 w-4 mr-2" />
          {t("feedFilters.filters")}
          {activeFilterCount > 0 && (
            <span className="ml-2 bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      
      <SheetContent>
        <SheetHeader>
          <div className="flex items-center justify-between">
            <SheetTitle>{t("feedFilters.filterQuestions")}</SheetTitle>
            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
              >
                {t("feedFilters.clearAll")}
              </Button>
            )}
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Tags */}
          <div>
            <h3 className="font-medium mb-3">{t("search.topics")}</h3>
            <div className="space-y-2">
              {availableTags.map((tag) => (
                <div key={tag} className="flex items-center space-x-2">
                  <Checkbox
                    id={`tag-${tag}`}
                    checked={filters.tags.includes(tag)}
                    onCheckedChange={() => toggleTag(tag)}
                  />
                  <Label htmlFor={`tag-${tag}`}>{tag}</Label>
                </div>
              ))}
            </div>
          </div>

          {/* Question State */}
          <div>
            <h3 className="font-medium mb-3">{t("feedFilters.questionStatus")}</h3>
            <div className="space-y-2">
              {availableStates.map((state) => (
                <div key={state.value} className="flex items-center space-x-2">
                  <Checkbox
                    id={`state-${state.value}`}
                    checked={filters.state.includes(state.value)}
                    onCheckedChange={() => {
                      onChange({
                        ...filters,
                        state: filters.state.includes(state.value)
                          ? filters.state.filter(s => s !== state.value)
                          : [...filters.state, state.value],
                      });
                    }}
                  />
                  <Label htmlFor={`state-${state.value}`}>{state.label}</Label>
                </div>
              ))}
            </div>
          </div>

          {/* Show Answered */}
          <div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="show-answered"
                checked={filters.showAnswered}
                onCheckedChange={(checked) => 
                  onChange({ ...filters, showAnswered: !!checked })
                }
              />
              <Label htmlFor="show-answered">
                {t("feedFilters.showQuestionsIVeAlready")}
              </Label>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
