sed -i -e '/if (overlapMode === '\''pseudo'\'') {/i\
      const isMulti = timelineStore.selectedItemIds.includes(itemId) && timelineStore.selectedItemIds.length > 1;\n\
      if (isMulti && dragStartSnapshot.value) {\n\
        const deltaUs = startUs - dragAnchorStartUs.value;\n\
        const moves: { fromTrackId: string; toTrackId: string; itemId: string; startUs: number }[] = [];\n\
        \n\
        let trackOffset = 0;\n\
        if (targetTrackId !== dragOriginTrackId.value) {\n\
            const origIdx = tracks.value.findIndex(t => t.id === dragOriginTrackId.value);\n\
            const newIdx = tracks.value.findIndex(t => t.id === targetTrackId);\n\
            if (origIdx !== -1 && newIdx !== -1) {\n\
                trackOffset = newIdx - origIdx;\n\
            }\n\
        }\n\
\n\
        for (const selectedId of timelineStore.selectedItemIds) {\n\
           let origTrackId = '"''"';\n\
           let origStartUs = 0;\n\
           for (const t of dragStartSnapshot.value.tracks) {\n\
             const it = t.items.find(x => x.id === selectedId);\n\
             if (it && it.kind === '"'clip'"') {\n\
               origTrackId = t.id;\n\
               origStartUs = it.timelineRange.startUs;\n\
               break;\n\
             }\n\
           }\n\
\n\
           let currTrackId = '"''"';\n\
           for (const t of tracks.value) {\n\
             if (t.items.some(x => x.id === selectedId)) {\n\
               currTrackId = t.id;\n\
               break;\n\
             }\n\
           }\n\
\n\
           if (origTrackId && currTrackId) {\n\
             let toTrackId = origTrackId;\n\
             if (trackOffset !== 0) {\n\
                 const origIdx = tracks.value.findIndex(t => t.id === origTrackId);\n\
                 const newIdx = origIdx + trackOffset;\n\
                 if (newIdx >= 0 && newIdx < tracks.value.length) {\n\
                     const targetT = tracks.value[newIdx];\n\
                     const origT = tracks.value[origIdx];\n\
                     if (targetT && origT && targetT.kind === origT.kind) {\n\
                         toTrackId = targetT.id;\n\
                     }\n\
                 }\n\
             }\n\
\n\
             moves.push({\n\
               fromTrackId: currTrackId,\n\
               toTrackId,\n\
               itemId: selectedId,\n\
               startUs: Math.max(0, origStartUs + deltaUs),\n\
             });\n\
           }\n\
        }\n\
\n\
        moves.sort((a, b) => {\n\
          return deltaUs >= 0 ? b.startUs - a.startUs : a.startUs - b.startUs;\n\
        });\n\
\n\
        if (moves.length > 0) {\n\
          try {\n\
            const cmd = {\n\
              type: '"'move_items'"',\n\
              moves,\n\
              quantizeToFrames: enableFrameSnap,\n\
            } as const;\n\
            timelineStore.applyTimeline(cmd as any, { saveMode: '"'none'"', skipHistory: true });\n\
            lastDragAppliedCmd.value = cmd as any;\n\
            draggingTrackId.value = targetTrackId;\n\
            hasPendingTimelinePersist.value = true;\n\
          } catch {}\n\
        }\n\
        return;\n\
      }\n\
' src/composables/timeline/useTimelineInteraction.ts
