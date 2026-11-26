import type { LegacyBoardFeed } from './legacy-board-feed.service';

/** Retitles the tab when the board is renamed, through the stream service nothing injects. */
export class RenameWatcher {
  title = '';

  watch(feed: LegacyBoardFeed): void {
    feed.events.subscribe((evt) => {
      if (evt.type === 'BOARD_RENAMED') this.retitle(String(evt['title']));
    });
  }

  retitle(title: string): void {
    this.title = title;
  }
}
