import { open } from '@tauri-apps/plugin-shell';
import { Bot, Files, FileText, FolderOpen, Github, Server, Settings, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useLocale } from '@/hooks/use-locale';

import { cn } from '@/lib/utils';
import { NavigationView } from '@/types/navigation';

interface NavigationSidebarProps {
  activeView: NavigationView;
  onViewChange: (view: NavigationView) => void;
}

export function NavigationSidebar({ activeView, onViewChange }: NavigationSidebarProps) {
  const { t } = useLocale();

  const navigationItems = [
    {
      id: NavigationView.EXPLORER,
      icon: Files,
      label: t.Navigation.explorer,
      tooltip: `${t.Navigation.explorerTooltip}`,
    },
    {
      id: NavigationView.PROJECTS,
      icon: FolderOpen,
      label: t.Navigation.projects,
      tooltip: `${t.Navigation.projectsTooltip}`,
    },
    {
      id: NavigationView.AGENTS_MARKETPLACE,
      icon: Bot,
      label: t.Navigation.agents,
      tooltip: `${t.Navigation.agentsTooltip}`,
    },
    {
      id: NavigationView.SKILLS_MARKETPLACE,
      icon: Zap,
      label: t.Navigation.skills,
      tooltip: `${t.Navigation.skillsTooltip}`,
    },
    {
      id: NavigationView.MCP_SERVERS,
      icon: Server,
      label: t.Navigation.mcpServers,
      tooltip: `${t.Navigation.mcpServersTooltip}`,
    },
  ];

  const handleSettingsClick = () => {
    onViewChange(NavigationView.SETTINGS);
  };

  const handleAgentsClick = () => {
    onViewChange(NavigationView.AGENTS_MARKETPLACE);
  };

  const handleGitHubClick = () => {
    open('https://github.com/talkcody/talkcody');
  };

  return (
    <div className="flex h-full w-12 flex-col border-r bg-gray-50 dark:bg-gray-900">
      {/* Top Navigation Items */}
      <div className="flex flex-col items-center space-y-1 p-1">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;

          return (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-10 w-10 p-0',
                    'hover:bg-gray-200 dark:hover:bg-gray-800',
                    isActive && 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400'
                  )}
                  onClick={() => {
                    if (item.id === NavigationView.AGENTS_MARKETPLACE) {
                      handleAgentsClick();
                    } else {
                      onViewChange(item.id);
                    }
                  }}
                >
                  <Icon className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{item.tooltip}</TooltipContent>
            </Tooltip>
          );
        })}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-10 w-10 p-0 hover:bg-gray-200 dark:hover:bg-gray-800"
              onClick={handleSettingsClick}
            >
              <Settings className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{t.Navigation.settingsTooltip}</TooltipContent>
        </Tooltip>
      </div>

      {/* Bottom Settings Items */}
      <div className="mt-auto flex flex-col items-center space-y-1 p-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-10 w-10 p-0 hover:bg-gray-200 dark:hover:bg-gray-800"
              onClick={handleGitHubClick}
            >
              <Github className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{t.Navigation.githubTooltip}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-10 w-10 p-0',
                'hover:bg-gray-200 dark:hover:bg-gray-800',
                activeView === NavigationView.LOGS &&
                  'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400'
              )}
              onClick={() => onViewChange(NavigationView.LOGS)}
            >
              <FileText className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{t.Navigation.logsTooltip}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
