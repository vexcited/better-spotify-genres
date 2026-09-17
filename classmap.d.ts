declare global {
	const MAP: {
		"context_menu": {
			"menu_item": string;
		};
		"main": {
			"global_navbar": {
			};
			"navbar": {
				"link": {
					"container": string;
					"container__active": string;
					"wrapper": string;
				};
			};
			"panel": {
			};
			"playbar": {
				"buttons": {
					"button": {
						"wrapper": string;
						"wrapper__active": string;
						"wrapper__indicator": string;
					};
				};
				"controls": {
				};
				"widget": {
				};
			};
			"sidebar": {
			};
			"topbar": {
				"left": {
					"button": {
						"icon": {
							"wrapper": string;
						};
						"wrapper": string;
					};
					"button_t": {
						"wrapper": string;
					};
				};
				"right": {
					"button": {
						"wrapper": string;
					};
					"button_t": {
						"wrapper": string;
					};
					"upgrade_button": {
						"wrapper": string;
					};
				};
				"wrapper": string;
			};
		};
		"modal": {
			"track_credits": {
				"container": string;
				"content": {
					"container": string;
				};
				"header": {
					"close": string;
					"container": string;
				};
			};
			"widget_generator": {
				"container": string;
				"content": {
					"container": string;
				};
				"header": {
					"close": string;
					"container": string;
				};
			};
		};
		"scrollable_text": {
			"container": string;
			"wrapper": string;
		};
		"search_box": {
			"container": string;
			"expand_button": string;
		};
		"search_chips": {
			"chip": string;
			"container": string;
			"wrapper": string;
			"wrapper_wrapper": string;
		};
		"settings": {
			"button": {
				"wrapper": string;
			};
			"header": {
				"container": string;
			};
			"section": {
				"container": string;
			};
			"text_input": string;
		};
		"sort_box": {
			"list": {
				"button": string;
			};
		};
		"tracklist": {
			"column_header": string;
		};
	};
}

export {};
